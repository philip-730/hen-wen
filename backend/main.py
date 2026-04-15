import json
import re
import asyncio
import logging

logger = logging.getLogger(__name__)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import anthropic
from google.cloud import bigquery

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

claude = anthropic.AsyncAnthropic()
bq = bigquery.Client()

MAX_BYTES = 100 * 1024 * 1024  # 100 MB (table is 0.12 MB, this is a non-issue)

SCHEMA = """
There is one table: skeleton-island.pokemon.all

Columns:
- ID (INTEGER) — Pokedex number
- Name (STRING)
- Form (STRING) — variant form e.g. Mega, Alolan, Galarian
- Type1 (STRING) — primary type
- Type2 (STRING) — secondary type, may be null
- Total (INTEGER) — sum of all base stats
- HP (INTEGER)
- Attack (INTEGER)
- Defense (INTEGER)
- `Sp_ Atk` (INTEGER) — Special Attack (backtick-escape this column name)
- `Sp_ Def` (INTEGER) — Special Defense (backtick-escape this column name)
- Speed (INTEGER)
- Generation (INTEGER) — 1 through 9
"""

SQL_SYSTEM = f"""You are a BigQuery SQL generator for a Pokemon dataset.

{SCHEMA}

Your response must be EITHER:
- A single valid BigQuery SQL query with no other text, no markdown, no explanation
- The exact string: CANNOT_ANSWER

Rules for SQL:
- Always use the fully qualified table name: skeleton-island.pokemon.all
- ALWAYS include LIMIT 100 unless the query is a pure aggregate (COUNT, AVG, SUM, etc.)
- Never use SELECT * — only select the columns you need
- Always backtick-escape `Sp_ Atk` and `Sp_ Def` — they contain special characters
- Always alias aggregate functions with descriptive snake_case names: AVG(Attack) AS avg_attack, COUNT(*) AS count, MAX(Total) AS max_total, etc.
- If the user asks for a chart, graph, plot, or visualization of any kind, write the SQL for the underlying data — NEVER return CANNOT_ANSWER for chart requests, the frontend handles rendering automatically
- For broad/exploratory questions ("break this down", "give me an overview", "analyze"), write a useful summary query (e.g. GROUP BY Generation with counts and averages)
- Base forms have Form = ' ' (a single space); Mega/regional variants have a descriptive Form value like 'Mega Venusaur'
- To get base forms only, filter with WHERE Form = ' ' — this reliably excludes Mega, Alolan, Galarian, etc.
- When the user asks about specific Pokemon without mentioning forms, default to base forms with WHERE Form = ' '
- When comparing multiple named groups (e.g. evolutionary lines, starter trios, custom teams), include a computed group column using CASE so the chart layer can split them: e.g. CASE WHEN ID IN (1,2,3) THEN 'Bulbasaur line' WHEN ID IN (4,5,6) THEN 'Charmander line' END AS group_name

If the question is not answerable with a SQL query against this data, respond with exactly: CANNOT_ANSWER
"""

NARRATE_SYSTEM = """You are a Pokemon data analyst presenting BigQuery results.
Be concise and analytical — highlight the most interesting patterns, outliers, or rankings in the data.
Lead with the key insight. Use specific numbers from the results.
Never render ASCII charts, tables, or visualizations — the frontend renders those automatically."""

CHART_SYSTEM = """You analyze Pokemon query results and output chart configurations as a JSON array.

Output ONLY a valid JSON array with no other text. Each element:
{"type": "bar"|"line"|"pie"|"radar", "x_key": "column_name", "y_keys": ["col1"], "title": "Chart Title"}

Always return at least one chart unless the data is genuinely unplottable (e.g. only free-form text with no numeric columns).
Return multiple charts when the user asked for multiple OR when the data clearly benefits from more than one view (e.g. separate bar charts for different metrics, or bar + radar together).

Chart type guidelines:
- bar: categorical comparisons — count/avg per type, generation, etc. (default choice)
- line: sequential/ordered data — stats by generation, sorted rankings
- pie: proportions — only if ≤10 categories
- radar: multi-stat profiles — ideal for 1-3 entities showing multiple numeric stats (e.g. HP/Attack/Defense/Speed)
- x_key must be a categorical or sequential column
- y_keys must be numeric columns only (1-3 per chart)
- ONLY use column names that literally appear in the data — never invent column names

Radar grouping: if the data has a group/category column and contains more than ~4 entities, use a SINGLE radar spec with "group_key": "group_column_name" — the frontend splits it into one chart per group automatically. Do NOT also emit separate radar specs for each group; that causes duplication."""

FALLBACK_SYSTEM = f"""You are a helpful assistant for a Pokemon data chatbot backed by BigQuery.
The app can query data AND automatically render charts (bar, line, pie, radar) when appropriate.

Here's what's available:

{SCHEMA}

If the user asks for a chart or visualization, tell them to ask a data question and a chart will be generated automatically (e.g. "show me average attack by type as a bar chart").
If the user asks what you can do, explain concisely what kinds of questions you can answer and that results render as charts automatically.
If the question is genuinely unanswerable with this dataset, say so briefly.
Keep responses short."""


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[Message] = []


def sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def strip_sql_fences(text: str) -> str:
    # Strip ```sql ... ``` or ``` ... ``` wrappers if the model ignores instructions
    text = re.sub(r"^```(?:sql)?\s*", "", text.strip(), flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text.strip())
    return text.strip()


def dry_run(sql: str) -> int:
    job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
    job = bq.query(sql, job_config=job_config)
    return job.total_bytes_processed


async def stream_chat(req: ChatRequest):
    yield sse({"type": "status", "message": "Generating query..."})

    messages = [{"role": m.role, "content": m.content} for m in req.history]
    messages.append({"role": "user", "content": req.message})

    sql_resp = await claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=SQL_SYSTEM,
        messages=messages,
    )
    sql = strip_sql_fences(sql_resp.content[0].text)

    is_sql = sql.upper().startswith("SELECT") or sql.upper().startswith("WITH")

    if not is_sql:
        async with claude.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=512,
            system=FALLBACK_SYSTEM,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield sse({"type": "token", "content": text})
        yield sse({"type": "done"})
        return

    yield sse({"type": "sql", "content": sql})
    yield sse({"type": "status", "message": "Checking query size..."})

    try:
        bytes_to_scan = await asyncio.to_thread(dry_run, sql)
    except Exception as e:
        yield sse({"type": "error", "message": f"Could not validate query: {e}"})
        return

    mb = bytes_to_scan / (1024 * 1024)
    if bytes_to_scan > MAX_BYTES:
        yield sse({"type": "error", "message": f"Query would scan {mb:.0f} MB — too large. Try narrowing the date range."})
        return

    yield sse({"type": "status", "message": f"Running query ({mb:.0f} MB)..."})

    try:
        result = await asyncio.to_thread(lambda: list(bq.query(sql).result()))
    except Exception as e:
        yield sse({"type": "error", "message": str(e)})
        return

    if not result:
        yield sse({"type": "token", "content": "The query returned no results."})
        yield sse({"type": "done"})
        return

    rows = [dict(row) for row in result[:100]]
    serializable_rows = [{k: str(v) for k, v in r.items()} for r in rows]
    rows_str = json.dumps(serializable_rows)

    yield sse({"type": "rows", "rows": serializable_rows, "total": len(result)})
    yield sse({"type": "status", "message": "Summarizing..."})

    # Run chart config and narration concurrently
    chart_prompt = f"Question: {req.message}\nColumns: {list(serializable_rows[0].keys())}\nSample ({min(10, len(serializable_rows))} rows): {json.dumps(serializable_rows[:10])}"

    async def get_chart_config():
        try:
            resp = await claude.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                system=CHART_SYSTEM,
                messages=[{"role": "user", "content": chart_prompt}],
            )
            raw = resp.content[0].text.strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"\s*```$", "", raw)
            cfg = json.loads(raw.strip())
            if isinstance(cfg, dict):
                cfg = [cfg]  # tolerate single object response
            logger.info(f"Chart configs: {cfg}")
            return cfg
        except Exception as e:
            logger.error(f"Chart generation failed: {e}")
            return None

    chart_task = asyncio.create_task(get_chart_config())
    chart_sent = False

    async with claude.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=NARRATE_SYSTEM,
        messages=[{"role": "user", "content": f"Question: {req.message}\n\nResults ({len(rows)} rows):\n{rows_str}"}],
    ) as stream:
        async for text in stream.text_stream:
            yield sse({"type": "token", "content": text})
            if not chart_sent and chart_task.done():
                chart_cfgs = chart_task.result()
                if chart_cfgs:
                    yield sse({"type": "chart", "configs": chart_cfgs})
                chart_sent = True

    if not chart_sent:
        chart_cfgs = await chart_task
        if chart_cfgs:
            yield sse({"type": "chart", "configs": chart_cfgs})

    yield sse({"type": "done"})


@app.post("/chat")
async def chat(req: ChatRequest):
    return StreamingResponse(
        stream_chat(req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
