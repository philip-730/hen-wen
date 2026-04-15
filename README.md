# Hen Wen

> *"Ask your data anything"* — a chatbot proof-of-concept that queries BigQuery via natural language.

Named after the oracular pig from *The Black Cauldron*.

## Stack

- **Frontend** — Next.js 16 + shadcn/ui (Catppuccin Mocha), streaming typewriter UI
- **Backend** — FastAPI + Anthropic Claude, BigQuery, SSE streaming
- **Infra** — Cloud Run (GCP), Terraform, Artifact Registry, Secret Manager
- **Build** — Nix flakes (uv2nix for Python, buildNpmPackage for Node, dockerTools for OCI images)

## Dev

```bash
nix develop        # full dev shell (node, python, uv, terraform, just, skopeo)
nix develop .#frontend
nix develop .#backend
```

Backend:
```bash
cd backend && uv run --env-file .env uvicorn main:app --reload
```

Frontend:
```bash
cd frontend && npm run dev
```

Requires `backend/.env` with `ANTHROPIC_API_KEY=sk-ant-...`

## Deploy

First time:
```bash
just bootstrap   # creates GCS state bucket, provisions infra, sets secret, deploys
```

Subsequent deploys:
```bash
just deploy          # both services
just deploy-backend
just deploy-frontend
```

Other:
```bash
just infra   # terraform apply
just urls    # print Cloud Run URLs
just destroy # tear everything down
```

## Architecture

```
Browser → Cloud Run (Next.js) → /api/chat proxy → Cloud Run (FastAPI)
                                                         ↓
                                               Anthropic Claude API
                                               Google BigQuery
```

The Next.js API route proxies to the backend using a GCP identity token for service-to-service auth. The backend runs a two-phase pipeline: generate SQL → query BigQuery → stream a narrated response.
