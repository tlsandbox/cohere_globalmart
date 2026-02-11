# Demo Runbook (45 Minutes)

## 1) Environment Prep (5 min)

1. Install dependencies:
   ```bash
   ./.venv/bin/pip install -r requirements.txt
   ./.venv/bin/pip install -e .
   ```
2. Confirm `.env` includes `COHERE_API_KEY`.
3. Start app:
   ```bash
   ./scripts/run_api_dev.sh
   ```
4. Verify health:
   ```bash
   curl http://127.0.0.1:8005/api/health
   ```

## 2) Business Story Setup (5 min)

Frame the problem:
- GlobalMart users drop early due to low search relevance.
- Competitor launched intelligent shopper assistant.
- Requirement: better relevance while keeping data private/off public internet.

Show the home page and explain:
- Natural language + voice + image entry points
- Private catalog retrieval
- Cohere-powered ranking and explanation chips

## 3) Live Product Discovery (10 min)

1. Run text query from home page.
2. Open personalized page and show explanation chips on cards.
3. Use `AI Explain (✨)` on a recommendation.
4. Add item to cart (`🛒`) and show cart modal updates.
5. Open profile modal and show signal counters (click/cart events).

## 4) Session AI Features (10 min)

1. Click refine buttons (`party`, `work`, `casual`) and explain session-aware retrieval.
2. Select an item and run `Complete the look (🧩)`.
3. Walk through how recommendations are generated from selected item + session intent.

## 5) Multimodal and Voice Reliability (5 min)

1. Trigger voice input:
   - browser speech path when available
   - fallback recorder + backend transcribe when needed
2. Upload an image and show image-guided recommendations.

## 6) Technical Deep Dive (7 min)

Cover pipeline order:
1. Intent extraction
2. Lexical retrieval
3. Dense embedding retrieval
4. RRF fusion
5. Cohere rerank
6. Business controls (gender/usage/season/recency)

Then show data model:
- recommendation sessions/items
- shopper profiles
- cart items
- shopper events

## 7) Evaluation and Close (3 min)

Run:
```bash
./.venv/bin/python scripts/evaluate_retrieval.py
```

Discuss summary from `docs/eval_last_run.json`:
- legacy lexical vs hybrid v2 latency and quality
- observed quality lift tradeoff vs latency

## Demo Backup Paths

- If Cohere is unavailable, app degrades gracefully to lexical/fallback recommendations.
- If voice transcription fails, continue via typed search and image upload.
- If all demo ports are used, restart and use the printed URL in `8005..8009`.
