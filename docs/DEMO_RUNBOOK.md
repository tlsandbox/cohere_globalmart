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
- Guardrails for image relevance (primary article-type focus)

## 3) Live Product Discovery (10 min)

1. Run text query from home page.
2. Open personalized page and show ranked recommendations.
3. Use `Explain` on a recommendation to show query-match reasoning and score bar.
4. Add item to cart (`Buy`) and show cart modal updates.
5. Open profile modal and show signal counters (click/cart events).

## 4) Session AI Features (10 min)

1. Select an item and run `Suggest` (`Complete the Look`).
2. Walk through how complementary article types are chosen from the selected anchor item.
3. Explain hybrid retrieval + business controls used to rank final results.

## 5) Multimodal and Voice Reliability (5 min)

1. Trigger voice input:
   - browser speech path when available
   - fallback recorder + backend transcribe when needed
2. Upload an image and show image-guided recommendations.
3. Demonstrate shirt-image behavior returning shirts (not shoes) due to article-focus guardrail.

## 6) Multilingual Walkthrough (7 min)

1. Use the top-right flag selector to switch language (`EN/JA/ZH/ES`).
2. Show translated navigation, status text, and card actions (`Explain/Suggest/Buy`).
3. Run a non-English query and show localized recommendation metadata.
4. Trigger `Suggest` in `ja` or `zh` and confirm response speed remains close to English.
## 7) Technical Deep Dive (5 min)

Cover pipeline order:
1. Query normalization (typo/synonym cleanup)
2. Intent extraction (heuristic + optional Cohere parse)
3. Lexical retrieval + dense embedding retrieval
4. RRF fusion
5. Adaptive rerank depth (Cohere rerank)
6. Business controls (gender/usage/season/recency + mismatch penalties)
7. Runtime caches (intent + query embedding)
8. Image primary-article focus guardrail

Then show data model:
- recommendation sessions/items
- shopper profiles
- cart items
- shopper events

## 8) Evaluation and Close (3 min)

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
