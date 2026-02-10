# GlobalMart Fashion Technical Walkthrough (<= 6 minutes)

## 1) Problem Statement (45s)
- GlobalMart shoppers are exiting early because search results are not personalized enough.
- Competitors introduced intelligent assistants, increasing intent capture and session depth.

## 2) Solution Summary (45s)
- A Cohere-powered assistant that supports:
  - Natural language query search
  - Image-guided discovery
  - Explainable fit checks
- All recommendations are grounded in private catalog data.

## 3) Live Demo Path (2m)
- Home page: run a text query and review ranked results.
- Upload flow: submit a product/outfit image and review matched recommendations.
- Match flow: click `Check Your Match` and review the signal-level rationale.

## 4) Technical Deep Dive (1m 30s)
- Retrieval: local candidate generation + Cohere rerank.
- Vision: Cohere model extracts gender/occasion/colors/article-types/search queries.
- Match: deterministic weighted heuristics + optional Cohere judgement.
- Storage: all sessions and match outcomes persisted in local SQLite.

## 5) Close (1m)
- This implementation demonstrates a secure, extensible foundation for AI-powered product discovery at GlobalMart Fashion.
