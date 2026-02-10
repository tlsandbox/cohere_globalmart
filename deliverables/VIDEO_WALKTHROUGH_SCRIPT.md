# RetailNext Technical Walkthrough (<= 6 minutes)

## Goal
Show that you built on top of the cookbook, explain architecture/code clearly, and prove the app works.

## 0:00-0:30 Problem + Build Scope
- "RetailNext received poor reviews because shoppers cannot find updated styles quickly."
- "I implemented a full-stack Outfit Assistant using the OpenAI sample_clothes cookbook data."
- "Three flows are live: natural-language search, image upload matching, and an added AI feature: Check Your Match explanations."

## 0:30-1:30 Architecture at a Glance
- Open `/Users/timothycllam/Documents/llm_sandbox/openai/codex_assignment/retailnext_outfit_assistant/app/api_server.py`.
- Explain API routes: `/api/search`, `/api/image-match`, `/api/personalized/{session_id}`, `/api/check-match`.
- Show orchestration in `/Users/timothycllam/Documents/llm_sandbox/openai/codex_assignment/retailnext_outfit_assistant/src/retailnext_outfit_assistant/service.py`.

## 1:30-2:30 Natural-Language Flow
- In UI, type: "my wife wants a sakura season t shirt".
- Explain logic:
  1. query -> embedding (`text-embedding-3-large`)
  2. cosine retrieval over catalog embeddings
  3. ranked recommendations rendered in personalized page
- Reference code: `search_by_text()` in `/Users/timothycllam/Documents/llm_sandbox/openai/codex_assignment/retailnext_outfit_assistant/src/retailnext_outfit_assistant/service.py`.

## 2:30-3:30 Image Upload Flow
- Click camera icon and upload an image.
- Explain logic:
  1. `gpt-4o-mini` extracts structured attributes/search queries from image
  2. generated queries are embedded and retrieved
  3. recommendations shown in same personalized interface
- Reference code: `analyze_outfit_image()` in `/Users/timothycllam/Documents/llm_sandbox/openai/codex_assignment/retailnext_outfit_assistant/src/retailnext_outfit_assistant/openai_utils.py` and `search_by_image()` in service.

## 3:30-4:40 Added AI Feature: Check Your Match
- Click "Check Your Match" on one item.
- Explain logic:
  1. model evaluates item vs session intent
  2. returns verdict/rationale/confidence JSON
  3. saved to DB and rendered inline
- Reference code: `check_match()` in `/Users/timothycllam/Documents/llm_sandbox/openai/codex_assignment/retailnext_outfit_assistant/src/retailnext_outfit_assistant/service.py` and `match_checks` table in `/Users/timothycllam/Documents/llm_sandbox/openai/codex_assignment/retailnext_outfit_assistant/src/retailnext_outfit_assistant/db.py`.

## 4:40-5:20 Data + Persistence
- Mention dataset and indexing:
  - 1,000 catalog items from cookbook sample
  - cached vector index in `data/cache/catalog_index.npz`
  - session/match persistence in `data/retailnext_demo.db`

## 5:20-6:00 Close
- "This prototype demonstrates how RetailNext can convert ambiguous shopper intent into explainable product recommendations."
- "Next step is pilot rollout with KPI tracking for conversion lift, time-to-item, and return-rate impact."
