# GlobalMart Fashion Assistant Demo (Cohere)

GlobalMart Fashion demo application for Cohere solution walkthroughs.

This implementation is built for a 45-minute technical demo and includes:
- Phase 1: reliability + UX completion (voice fallback, cart/profile/footer actions, feedback events)
- Phase 2: retrieval pipeline v2 (intent extraction, dense + lexical retrieval, RRF fusion, Cohere rerank, business controls)
- Phase 3: demo AI features (`Complete the look`, session refine panel for `party/work/casual`, explanation chips)
- Phase 4: private-endpoint-ready Cohere config path, reduced sensitive logging behavior, evaluation script, docs/runbook

## Documentation

- [Documentation Index](./docs/README.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Demo Runbook](./docs/DEMO_RUNBOOK.md)
- [Troubleshooting Guide](./docs/TROUBLESHOOTING.md)

## Quickstart

### 1) Install

```bash
cd /Users/timothycllam/Documents/llm_sandbox/cohere/assignment
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt
./.venv/bin/pip install -e .
```

### 2) Configure environment

```bash
cp .env.template .env
# Set COHERE_API_KEY in .env
```

Optional private deployment endpointing:
- Set `RN_COHERE_CONFIG_PATH` to a JSON file path.
- Supported keys in that JSON: `api_key`, `base_url`, `timeout_seconds`, `max_retries`.

### 3) Download sample data (if missing)

```bash
./.venv/bin/python scripts/download_sample_clothes.py
```

### 4) Run app

```bash
./scripts/run_api_dev.sh
```

Port behavior:
- Default `PORT=8005`
- Auto-selects next free port in `8005..8009`
- Exits with a clear message if all ports in range are occupied

Open the exact URL printed by the script (for example `http://127.0.0.1:8005`).

## Retrieval v2

For text/image recommendations, the service now executes:
1. Structured intent extraction
2. Lexical candidate generation
3. Dense semantic candidate generation (Cohere embeddings)
4. Candidate fusion with Reciprocal Rank Fusion (RRF)
5. Cohere rerank
6. Business controls (gender/usage/season/recency boosts)

## API Endpoints

- `GET /api/health`
- `GET /api/profile?shopper_name=...`
- `GET /api/cart?shopper_name=...`
- `POST /api/cart/add`
- `POST /api/cart/remove`
- `POST /api/feedback`
- `GET /api/content/{slug}`
- `GET /api/home-products?limit=24&gender=Women|Men`
- `POST /api/search`
- `POST /api/image-match`
- `GET /api/personalized/{session_id}`
- `POST /api/complete-look`
- `POST /api/refine-session`
- `POST /api/check-match` (legacy compatibility)
- `POST /api/transcribe`
- `GET /api/image/{product_id}`

## Evaluation Script

Run before/after retrieval comparison (legacy lexical vs hybrid v2):

```bash
./.venv/bin/python scripts/evaluate_retrieval.py
```

Output JSON is written to:
- `docs/eval_last_run.json`

## Notes

- Raw uploaded audio/image payloads are not persisted by the app.
- Voice flow is non-blocking: browser speech path first, recorder + backend transcribe fallback second.
- If local product image files are missing, the API serves `/static/placeholder-image.svg`.
