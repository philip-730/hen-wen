import json
import re
import asyncio
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

If the question is not answerable with a SQL query against this data, respond with exactly: CANNOT_ANSWER
"""

NARRATE_SYSTEM = """You are a helpful assistant presenting Pokemon query results.
Summarize what the data shows conversationally and concisely."""

FALLBACK_SYSTEM = f"""You are a helpful assistant for a Pokemon data chatbot backed by BigQuery.
Here's what's available:

{SCHEMA}

If the user asks what you can do, explain concisely what kinds of questions you can answer.
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
        max_tokens=1024,
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

    async with claude.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=NARRATE_SYSTEM,
        messages=[{"role": "user", "content": f"Question: {req.message}\n\nResults ({len(rows)} rows):\n{rows_str}"}],
    ) as stream:
        async for text in stream.text_stream:
            yield sse({"type": "token", "content": text})

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
