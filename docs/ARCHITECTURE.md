# Architecture

## System Overview

GlobalMart Fashion Assistant is a single FastAPI service that serves:
- Frontend pages (`/`, `/personalized`)
- API routes (`/api/*`)

Core components:
- SQLite for sessions, recommendation history, profiles, carts, and shopper feedback
- Local product catalog (`sample_styles_with_embeddings.csv`) with cached index artifacts
- Cohere APIs for intent parsing, embeddings, reranking, vision analysis, and optional match judgement
- Frontend flows for text search, voice query, image match, refine-session, and complete-the-look
- Multilingual layer for UI phrases + localized API payloads (`en`, `ja`, `zh`, `es`)

## Component Diagram

```mermaid
flowchart LR
    Browser["Browser UI\nindex.html + personalized.html"]
    JS["home.js / personalized.js"]
    API["FastAPI\napp/api_server.py"]
    Service["OutfitAssistantService\nservice.py"]
    DB["SQLite\ndata/retailnext_demo.db"]
    Catalog["Catalog metadata\nlocal cache + dense index"]
    Cohere["Cohere APIs\nChat + Vision + Embed + Rerank"]
    I18N["Language layer\nUI i18n + API localization"]

    Browser --> JS
    JS --> API
    API --> Service
    Service --> DB
    Service --> Catalog
    Service --> Cohere
    JS --> I18N
    Service --> I18N
```

## Retrieval Pipeline v2 (Cohere-first)

For recommendation generation:
1. Parse shopper intent (heuristic + optional Cohere structured intent extraction).
2. Generate lexical candidates from local metadata.
3. Generate dense candidates from Cohere embeddings + cosine similarity.
4. Fuse candidate lists with Reciprocal Rank Fusion (RRF).
5. Rerank fused list with Cohere rerank.
6. Apply business controls:
   - gender alignment
   - article/usage/season preference boosts
   - optional recency boost by product year
7. Return recommendations with explanation chips.

## Primary Runtime Flows

### Multilingual Request Flow

1. Frontend chooses a language from the header flag selector.
2. Frontend appends `lang` to API calls and page URLs.
3. Service localizes display metadata and narrative fields.
4. For non-English text search, service translates query to English (Cohere) before hybrid retrieval.
5. Recommendations are returned in localized display format while ranking logic remains consistent.

### Text Search

1. Frontend posts `/api/search`.
2. Service runs retrieval v2 and stores session + ranked items.
3. Frontend loads `/api/personalized/{session_id}`.

### Image Match

1. Frontend uploads to `/api/image-match`.
2. Cohere vision extracts image attributes + candidate queries.
3. Service runs retrieval v2 and persists session.
4. Personalized recommendations are returned with explanations.

### Session Refine

1. Frontend posts `/api/refine-session` with refinement (`party`, `work`, `casual`).
2. Service creates a refined query from the prior session context.
3. Retrieval v2 runs again and a new session is stored.

### Complete the Look

1. Frontend posts `/api/complete-look` for a selected recommendation.
2. Service builds a complementary query and excludes the anchor item.
3. Returns additional compatible recommendations + explanation chips.

## Reliability and Security Notes

- Voice path uses browser speech first, then recorder-to-backend fallback.
- Uploaded voice blobs are written to temporary files only for transcription and deleted immediately.
- Sensitive payloads are not persisted in logs.
- Cohere base URL can be set directly (`COHERE_API_BASE_URL`) or via private config JSON (`RN_COHERE_CONFIG_PATH`).
- Dev launcher enforces/rotates ports in range `8005..8009`.
