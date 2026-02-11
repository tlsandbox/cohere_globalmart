"""Core recommendation service orchestrating Cohere-powered search and outfit suggestions."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
import hashlib
import json
import logging
import os
from pathlib import Path
import tempfile
import time
from typing import Any

import numpy as np

from retailnext_outfit_assistant.catalog import CatalogIndex, CatalogItem, build_or_load_index, unique_article_types
from retailnext_outfit_assistant.cohere_utils import (
    CohereConfig,
    analyze_outfit_image,
    embed_texts,
    extract_structured_intent,
    llm_match_judgement,
    make_client,
    rerank_documents,
)
from retailnext_outfit_assistant.db import RetailNextDB
from retailnext_outfit_assistant.retrieval import top_k_cosine


_FALLBACK_IMAGE_PATH = "/static/placeholder-image.svg"
_LOGGER = logging.getLogger(__name__)
_COHERE_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="cohere-call")

_GENERIC_KEYWORDS = {
    "a",
    "an",
    "and",
    "for",
    "from",
    "i",
    "in",
    "is",
    "item",
    "look",
    "my",
    "need",
    "of",
    "on",
    "outfit",
    "please",
    "search",
    "shirt",
    "shirts",
    "show",
    "style",
    "t",
    "tee",
    "tshirt",
    "tshirts",
    "the",
    "this",
    "to",
    "want",
    "wants",
    "wife",
    "wives",
    "husband",
    "woman",
    "women",
    "man",
    "men",
    "girl",
    "girls",
    "boy",
    "boys",
    "her",
    "him",
}

_USAGE_LEXICON: dict[str, set[str]] = {
    "Party": {"party", "wedding", "cocktail", "date", "nightout", "celebration"},
    "Work": {"work", "office", "business", "professional", "meeting"},
    "Casual": {"casual", "daily", "weekend", "relaxed"},
    "Formal": {"formal", "smart", "elegant", "blazer", "suit"},
    "Sports": {"sport", "sports", "gym", "training", "running", "active"},
    "Ethnic": {"ethnic", "traditional", "festive", "kurta", "saree"},
}

_COMPLEMENTARY_HINTS: dict[str, str] = {
    "shirt": "trousers sneakers",
    "tshirt": "jeans sneakers",
    "tops": "bottomwear shoes",
    "kurta": "bottomwear sandals",
    "dress": "heels outerwear",
    "jeans": "tops sneakers",
    "trousers": "tops shoes",
    "shoes": "tops bottomwear",
    "flip flops": "casual tops",
}

_FOOTER_CONTENT: dict[str, tuple[str, str]] = {
    "about": (
        "About GlobalMart Fashion",
        "GlobalMart Fashion is a private-commerce demo brand focused on secure, AI-assisted discovery using Cohere models.",
    ),
    "careers": (
        "Careers",
        "We are hiring solution architects, applied ML engineers, and retail data specialists across product and platform teams.",
    ),
    "stores": (
        "Stores",
        "This demo storefront is online-only. In production, omnichannel inventory would be integrated from private warehouse systems.",
    ),
    "customer-service": (
        "Customer Service",
        "For this assignment demo, customer support is simulated. Typical SLA is under 24 hours for order and return requests.",
    ),
    "delivery": (
        "Delivery",
        "Standard delivery is 3-5 business days. Express delivery depends on region and stock availability.",
    ),
    "returns": (
        "Returns",
        "Returns are accepted within 30 days in original condition. Refund timing depends on payment provider processing windows.",
    ),
    "terms": (
        "Terms and Conditions",
        "Demo terms: this environment is for technical showcase only and does not process real payments.",
    ),
    "privacy": (
        "Privacy Notice",
        "Data remains on private infrastructure in this architecture. Shopper events are stored for personalization and can be deleted by policy.",
    ),
    "cookies": (
        "Cookie Settings",
        "No third-party ad cookies are required in this demo. Session state is used for recommendation continuity.",
    ),
    "instagram": (
        "Instagram",
        "Social integrations are mocked in this demo. Production builds can link verified GlobalMart social channels.",
    ),
    "youtube": (
        "YouTube",
        "Video integrations are mocked in this demo. Product explainers and style guides can be linked in production.",
    ),
    "linkedin": (
        "LinkedIn",
        "Enterprise updates and hiring announcements are represented as static content in this demo environment.",
    ),
}


class OutfitAssistantService:
    def __init__(self, root_dir: Path | None = None) -> None:
        self.root_dir = root_dir or Path(__file__).resolve().parents[2]
        self.data_dir = self.root_dir / "data" / "sample_clothes"
        self.cache_dir = self.root_dir / "data" / "cache"
        self.image_dir = self.data_dir / "sample_images"
        self.db = RetailNextDB(self.root_dir / "data" / "retailnext_demo.db")

        self.cfg = CohereConfig.from_env()
        self.client = None

        self.search_candidate_pool = self._env_int("RN_SEARCH_CANDIDATE_POOL", 180)
        self.search_timeout_seconds = self._env_timeout("RN_AI_SEARCH_TIMEOUT_SECONDS", 25.0)
        self.image_timeout_seconds = self._env_timeout("RN_AI_IMAGE_TIMEOUT_SECONDS", 50.0)
        self.match_timeout_seconds = self._env_timeout("RN_AI_MATCH_TIMEOUT_SECONDS", 20.0)
        self.request_timeout_seconds = self._env_timeout("RN_AI_REQUEST_TIMEOUT_SECONDS", 20.0)
        self.dense_build_timeout_seconds = self._env_timeout("RN_DENSE_BUILD_TIMEOUT_SECONDS", 120.0)
        self.embed_batch_size = self._env_int("RN_EMBED_BATCH_SIZE", 96)
        self.prefer_newest = self._env_bool("RN_PREFER_NEWEST", True)

        self.default_shopper_name = (
            os.getenv("RN_DEFAULT_SHOPPER_NAME", "GlobalMart Fashion Shopper").strip()
            or "GlobalMart Fashion Shopper"
        )

        self._transcriber = None
        self._transcriber_name = os.getenv("RN_TRANSCRIBE_MODEL", "tiny.en").strip() or "tiny.en"
        self._transcriber_compute_type = os.getenv("RN_TRANSCRIBE_COMPUTE_TYPE", "int8").strip() or "int8"
        self._transcriber_device = os.getenv("RN_TRANSCRIBE_DEVICE", "cpu").strip() or "cpu"

        self.index: CatalogIndex = build_or_load_index(self.data_dir, self.cache_dir)
        self.article_types = unique_article_types(self.index.items)
        self.catalog_colors = sorted({item.base_colour for item in self.index.items if item.base_colour})
        self._id_to_row = {item.id: i for i, item in enumerate(self.index.items)}
        self._search_docs = [self._catalog_search_document(item) for item in self.index.items]
        self._search_docs_normalized = [self._normalize_text(value) for value in self._search_docs]

        self._dense_embeddings: np.ndarray | None = None
        self._dense_norms: np.ndarray | None = None
        self._dense_ready = False
        self._dense_signature = self._catalog_signature()

        self._session_explanations: dict[str, dict[int, list[str]]] = {}

        self.db.upsert_catalog(self.index.items, self.image_dir)
        self.db.ensure_shopper_profile(self.default_shopper_name)

    @property
    def ai_enabled(self) -> bool:
        if os.getenv("COHERE_API_KEY", "").strip():
            return True
        config_path = os.getenv("RN_COHERE_CONFIG_PATH", "").strip()
        if not config_path:
            return False
        path = Path(config_path)
        if not path.exists() or not path.is_file():
            return False
        try:
            parsed = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return False
        return bool(str(parsed.get("api_key", "")).strip())

    def _ensure_client(self):
        if not self.ai_enabled:
            raise RuntimeError("COHERE_API_KEY is not set.")
        if self.client is None:
            self.client = make_client()
        return self.client

    @staticmethod
    def _env_timeout(name: str, default: float) -> float:
        raw = os.getenv(name)
        if raw is None or not raw.strip():
            return default
        try:
            value = float(raw)
        except Exception:
            return default
        return value if value > 0 else default

    @staticmethod
    def _env_int(name: str, default: int) -> int:
        raw = os.getenv(name)
        if raw is None or not raw.strip():
            return default
        try:
            value = int(raw)
        except Exception:
            return default
        return value if value > 0 else default

    @staticmethod
    def _env_bool(name: str, default: bool) -> bool:
        raw = os.getenv(name)
        if raw is None or not raw.strip():
            return default
        return raw.strip().lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def _remaining_timeout(deadline: float) -> float:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("AI time budget was exceeded.")
        return remaining

    def _run_with_timeout(self, operation: str, fn, timeout_seconds: float):
        safe_timeout = max(1.0, float(timeout_seconds))
        future = _COHERE_EXECUTOR.submit(fn)
        try:
            return future.result(timeout=safe_timeout)
        except FutureTimeoutError as exc:
            future.cancel()
            raise RuntimeError(f"{operation} timed out after {int(round(safe_timeout))}s.") from exc
        except Exception as exc:
            raise RuntimeError(f"{operation} failed: {exc}") from exc

    @staticmethod
    def _normalize_text(value: Any) -> str:
        text = str(value or "").strip().lower()
        chars = [ch if ch.isalnum() or ch.isspace() else " " for ch in text]
        return " ".join("".join(chars).split())

    @staticmethod
    def _tokenize(value: Any) -> list[str]:
        return [token for token in OutfitAssistantService._normalize_text(value).split() if token]

    @staticmethod
    def _compact(value: Any) -> str:
        return "".join(ch for ch in OutfitAssistantService._normalize_text(value) if ch.isalnum())

    @staticmethod
    def _dedupe(values: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for value in values:
            cleaned = str(value or "").strip()
            if not cleaned:
                continue
            key = cleaned.casefold()
            if key in seen:
                continue
            seen.add(key)
            out.append(cleaned)
        return out

    @staticmethod
    def _catalog_search_document(item: CatalogItem) -> str:
        year_text = str(item.year) if item.year is not None else "unknown"
        return (
            f"{item.name}. "
            f"Gender: {item.gender}. "
            f"Type: {item.article_type}. "
            f"Category: {item.master_category}/{item.sub_category}. "
            f"Color: {item.base_colour}. "
            f"Usage: {item.usage}. "
            f"Season: {item.season}. "
            f"Year: {year_text}."
        )

    def _catalog_signature(self) -> str:
        hasher = hashlib.sha256()
        hasher.update(self.cfg.embed_model.encode("utf-8"))
        for item in self.index.items:
            hasher.update(f"{item.id}|{item.name}|{item.article_type}|{item.base_colour}|{item.usage}".encode("utf-8"))
        return hasher.hexdigest()

    def _dense_cache_paths(self) -> tuple[Path, Path]:
        safe_model = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in self.cfg.embed_model)
        npz_path = self.cache_dir / f"cohere_dense_{safe_model}.npz"
        meta_path = self.cache_dir / f"cohere_dense_{safe_model}.meta.json"
        return npz_path, meta_path

    def _load_dense_cache(self) -> bool:
        npz_path, meta_path = self._dense_cache_paths()
        if not npz_path.exists() or not meta_path.exists():
            return False
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if meta.get("signature") != self._dense_signature:
                return False
            arrays = np.load(npz_path)
            embeddings = arrays["embeddings"].astype(np.float32, copy=False)
            norms = arrays["norms"].astype(np.float32, copy=False)
            if embeddings.ndim != 2 or norms.ndim != 1:
                return False
            if embeddings.shape[0] != len(self.index.items) or norms.shape[0] != embeddings.shape[0]:
                return False
            self._dense_embeddings = embeddings
            self._dense_norms = norms
            self._dense_ready = True
            return True
        except Exception:
            return False

    def _save_dense_cache(self, embeddings: np.ndarray, norms: np.ndarray) -> None:
        npz_path, meta_path = self._dense_cache_paths()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(npz_path, embeddings=embeddings.astype(np.float32), norms=norms.astype(np.float32))
        meta_path.write_text(
            json.dumps(
                {
                    "signature": self._dense_signature,
                    "model": self.cfg.embed_model,
                    "count": int(embeddings.shape[0]),
                    "dim": int(embeddings.shape[1]),
                }
            ),
            encoding="utf-8",
        )

    def _ensure_dense_index(self, *, deadline: float | None) -> bool:
        if self._dense_ready and self._dense_embeddings is not None and self._dense_norms is not None:
            return True
        if not self.ai_enabled:
            return False
        if self._load_dense_cache():
            return True

        client = self._ensure_client()
        all_vectors: list[list[float]] = []
        batch_size = max(16, min(self.embed_batch_size, 256))

        for start in range(0, len(self._search_docs), batch_size):
            batch = self._search_docs[start : start + batch_size]
            call_timeout = self.request_timeout_seconds
            if deadline is not None:
                call_timeout = min(call_timeout, self._remaining_timeout(deadline))

            vectors = self._run_with_timeout(
                "Embedding batch request",
                lambda b=batch: embed_texts(
                    client=client,
                    texts=b,
                    model=self.cfg.embed_model,
                    input_type="search_document",
                ),
                call_timeout,
            )
            if len(vectors) != len(batch):
                raise RuntimeError("Dense embedding build returned an unexpected vector count.")
            all_vectors.extend(vectors)

        embeddings = np.asarray(all_vectors, dtype=np.float32)
        norms = np.linalg.norm(embeddings, axis=1).astype(np.float32)
        self._dense_embeddings = embeddings
        self._dense_norms = norms
        self._dense_ready = True
        self._save_dense_cache(embeddings, norms)
        return True

    def _dense_candidate_rows(
        self,
        query: str,
        *,
        pool_size: int,
        deadline: float | None,
        build_if_missing: bool = True,
    ) -> list[int]:
        if not self.ai_enabled:
            return []
        if not self._dense_ready and not build_if_missing and not self._load_dense_cache():
            return []
        if not self._ensure_dense_index(deadline=deadline):
            return []
        if self._dense_embeddings is None or self._dense_norms is None:
            return []

        client = self._ensure_client()
        call_timeout = self.request_timeout_seconds
        if deadline is not None:
            call_timeout = min(call_timeout, self._remaining_timeout(deadline))

        vectors = self._run_with_timeout(
            "Query embedding request",
            lambda: embed_texts(
                client=client,
                texts=[query],
                model=self.cfg.embed_model,
                input_type="search_query",
            ),
            call_timeout,
        )
        if not vectors:
            return []

        query_embedding = np.asarray(vectors[0], dtype=np.float32)
        idx, _scores = top_k_cosine(
            query_embedding,
            self._dense_embeddings,
            self._dense_norms,
            min(max(int(pool_size), 1), self._dense_embeddings.shape[0]),
        )
        return [int(value) for value in idx]

    def _lexical_candidate_rows(self, query: str, *, pool_size: int) -> list[int]:
        normalized_query = self._normalize_text(query)
        tokens = [
            token
            for token in self._tokenize(normalized_query)
            if len(token) >= 3 and token not in _GENERIC_KEYWORDS
        ]
        query_blob = f" {normalized_query} "

        scored_rows: list[tuple[int, float]] = []
        for row_idx, doc in enumerate(self._search_docs_normalized):
            score = 0.0
            if normalized_query and query_blob in f" {doc} ":
                score += 4.0
            for token in tokens:
                if f" {token} " in f" {doc} ":
                    score += 1.0
            if score > 0:
                scored_rows.append((row_idx, score))

        if not scored_rows:
            return list(range(min(len(self._search_docs), max(pool_size, 50))))

        scored_rows.sort(key=lambda item: item[1], reverse=True)
        return [row_idx for row_idx, _ in scored_rows[: max(pool_size, 20)]]

    def _rrf_fuse(self, rankings: list[list[int]], *, limit: int, k: int = 60) -> list[int]:
        scores: dict[int, float] = {}
        for ranking in rankings:
            for rank_index, row_idx in enumerate(ranking):
                scores[row_idx] = scores.get(row_idx, 0.0) + 1.0 / (k + rank_index + 1)
        ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        return [row_idx for row_idx, _ in ordered[: max(1, limit)]]

    def _rank_query_candidates(
        self,
        query: str,
        candidate_rows: list[int],
        *,
        top_k: int,
        deadline: float | None,
    ) -> tuple[list[tuple[int, float]], bool]:
        if not candidate_rows:
            return [], False

        ai_used = False
        if self.ai_enabled:
            client = self._ensure_client()
            documents = [self._search_docs[row_idx] for row_idx in candidate_rows]
            call_timeout = self.request_timeout_seconds
            if deadline is not None:
                call_timeout = min(call_timeout, self._remaining_timeout(deadline))

            ranked = self._run_with_timeout(
                "Rerank request",
                lambda: rerank_documents(
                    client=client,
                    query=query,
                    documents=documents,
                    model=self.cfg.rerank_model,
                    top_n=min(max(top_k, 1), len(documents)),
                ),
                call_timeout,
            )

            if ranked:
                ai_used = True
                mapped: list[tuple[int, float]] = []
                for doc_idx, score in ranked:
                    if 0 <= doc_idx < len(candidate_rows):
                        mapped.append((candidate_rows[doc_idx], float(score)))
                if mapped:
                    return mapped[:top_k], ai_used

        fallback_scores: list[tuple[int, float]] = []
        normalized_query = self._normalize_text(query)
        token_set = set(self._tokenize(normalized_query))
        for rank_order, row_idx in enumerate(candidate_rows):
            doc = self._search_docs_normalized[row_idx]
            overlap = sum(1 for token in token_set if f" {token} " in f" {doc} ")
            score = overlap / max(len(token_set), 1)
            score = max(score, 1.0 / (rank_order + 1))
            fallback_scores.append((row_idx, float(score)))
        fallback_scores.sort(key=lambda item: item[1], reverse=True)
        return fallback_scores[:top_k], ai_used

    def _heuristic_intent(
        self,
        query_text: str,
        *,
        image_summary: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        tokens = self._tokenize(query_text)
        query_norm = self._normalize_text(query_text)
        query_compact_tokens = {self._compact(token) for token in tokens}

        gender = ""
        women_tokens = {"woman", "women", "wife", "female", "ladies", "lady", "girl", "girls", "her"}
        men_tokens = {"man", "men", "husband", "male", "gentleman", "gentlemen", "boy", "boys", "him"}
        if any(token in women_tokens for token in tokens):
            gender = "Women"
        elif any(token in men_tokens for token in tokens):
            gender = "Men"

        article_hints: list[str] = []
        for article in self.article_types:
            article_norm = self._normalize_text(article)
            article_compact = self._compact(article)
            if not article_norm:
                continue
            if f" {article_norm} " in f" {query_norm} ":
                article_hints.append(article)
                continue
            if article_compact in query_compact_tokens:
                article_hints.append(article)
                continue
            singular = article_compact[:-1] if article_compact.endswith("s") else article_compact
            if singular and singular in query_compact_tokens:
                article_hints.append(article)

        color_hints: list[str] = []
        for color in self.catalog_colors:
            if f" {self._normalize_text(color)} " in f" {query_norm} ":
                color_hints.append(color)

        usage_hints: list[str] = []
        for usage, keywords in _USAGE_LEXICON.items():
            if any(keyword in tokens for keyword in keywords):
                usage_hints.append(usage)

        season_hints: list[str] = []
        for season in ["Summer", "Winter", "Spring", "Fall"]:
            if season.lower() in tokens:
                season_hints.append(season)

        style_keywords = [
            token
            for token in tokens
            if len(token) >= 4 and token not in _GENERIC_KEYWORDS and token not in {"women", "woman", "men", "man"}
        ]

        if image_summary:
            image_gender = str(image_summary.get("gender") or "").strip()
            if image_gender and self._normalize_text(image_gender) not in {"unknown", "unisex", ""}:
                gender = image_gender

            image_colors = image_summary.get("colors", [])
            if isinstance(image_colors, list):
                color_hints.extend([str(value).strip() for value in image_colors if str(value).strip()])

            image_article_types = image_summary.get("article_types", [])
            if isinstance(image_article_types, list):
                article_hints.extend([str(value).strip() for value in image_article_types if str(value).strip()])

            occasion = str(image_summary.get("occasion") or "").strip()
            if occasion and self._normalize_text(occasion) not in {"unknown", ""}:
                usage_hints.append(occasion.title())

            season = str(image_summary.get("season") or "").strip()
            if season and self._normalize_text(season) not in {"unknown", ""}:
                season_hints.append(season.title())

            image_keywords = image_summary.get("style_keywords", [])
            if isinstance(image_keywords, list):
                style_keywords.extend([str(value).strip() for value in image_keywords if str(value).strip()])

        return {
            "query_text": query_text,
            "gender": gender,
            "article_hints": self._dedupe(article_hints),
            "color_hints": self._dedupe(color_hints),
            "usage_hints": self._dedupe(usage_hints),
            "season_hints": self._dedupe(season_hints),
            "style_keywords": self._dedupe(style_keywords),
        }

    def _merge_intent(self, base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
        merged = dict(base)

        overlay_gender = str(overlay.get("gender") or "").strip()
        if overlay_gender and self._normalize_text(overlay_gender) not in {"unknown", ""}:
            merged["gender"] = overlay_gender

        overlay_usage = str(overlay.get("usage") or "").strip()
        if overlay_usage and self._normalize_text(overlay_usage) not in {"unknown", ""}:
            merged["usage_hints"] = self._dedupe(list(merged.get("usage_hints", [])) + [overlay_usage])

        overlay_season = str(overlay.get("season") or "").strip()
        if overlay_season and self._normalize_text(overlay_season) not in {"unknown", "all", ""}:
            merged["season_hints"] = self._dedupe(list(merged.get("season_hints", [])) + [overlay_season])

        overlay_articles = overlay.get("article_types", [])
        if isinstance(overlay_articles, list):
            merged["article_hints"] = self._dedupe(
                list(merged.get("article_hints", []))
                + [str(value).strip() for value in overlay_articles if str(value).strip()]
            )

        overlay_colors = overlay.get("colors", [])
        if isinstance(overlay_colors, list):
            merged["color_hints"] = self._dedupe(
                list(merged.get("color_hints", []))
                + [str(value).strip() for value in overlay_colors if str(value).strip()]
            )

        overlay_keywords = overlay.get("style_keywords", [])
        if isinstance(overlay_keywords, list):
            merged["style_keywords"] = self._dedupe(
                list(merged.get("style_keywords", []))
                + [str(value).strip() for value in overlay_keywords if str(value).strip()]
            )

        return merged

    def _extract_intent(
        self,
        query_text: str,
        *,
        image_summary: dict[str, Any] | None = None,
        deadline: float | None,
    ) -> dict[str, Any]:
        heuristic = self._heuristic_intent(query_text, image_summary=image_summary)
        if not self.ai_enabled:
            return heuristic

        client = self._ensure_client()
        call_timeout = self.request_timeout_seconds
        if deadline is not None:
            call_timeout = min(call_timeout, self._remaining_timeout(deadline))

        try:
            llm_intent = self._run_with_timeout(
                "Intent extraction request",
                lambda: extract_structured_intent(
                    client=client,
                    query_text=query_text,
                    article_types=self.article_types,
                    model=self.cfg.intent_model,
                ),
                call_timeout,
            )
        except Exception:
            _LOGGER.warning("Intent extraction fell back to heuristic parsing.")
            return heuristic

        return self._merge_intent(heuristic, llm_intent)

    def _intent_from_session(self, session: dict[str, Any]) -> dict[str, Any]:
        query_text = str(session.get("query_text") or "").strip()
        image_summary: dict[str, Any] = {}
        raw_image_summary = session.get("image_summary")
        if raw_image_summary:
            try:
                parsed = json.loads(str(raw_image_summary))
                if isinstance(parsed, dict):
                    image_summary = parsed
            except Exception:
                image_summary = {}
        return self._heuristic_intent(query_text, image_summary=image_summary)

    def _business_adjustment(self, intent: dict[str, Any], item: CatalogItem) -> tuple[float, list[str]]:
        boost = 0.0
        chips: list[str] = []

        expected_gender = str(intent.get("gender") or "").strip()
        if expected_gender and self._normalize_text(expected_gender) not in {"unknown", "unisex"}:
            if self._normalize_text(expected_gender) == self._normalize_text(item.gender):
                boost += 0.30
                chips.append("Gender aligned")
            else:
                boost -= 0.45
                chips.append("Gender mismatch penalty")

        article_hints = [str(value).strip() for value in intent.get("article_hints", []) if str(value).strip()]
        if article_hints:
            article_norm = self._normalize_text(item.article_type)
            exact_match = any(self._normalize_text(value) == article_norm for value in article_hints)
            partial_match = any(
                self._normalize_text(value) in article_norm or article_norm in self._normalize_text(value)
                for value in article_hints
            )
            if exact_match:
                boost += 0.24
                chips.append("Article type match")
            elif partial_match:
                boost += 0.12
                chips.append("Article type related")
            else:
                boost -= 0.08

        color_hints = [str(value).strip() for value in intent.get("color_hints", []) if str(value).strip()]
        if color_hints:
            color_norm = self._normalize_text(item.base_colour)
            if any(self._normalize_text(value) == color_norm for value in color_hints):
                boost += 0.12
                chips.append("Color preference match")

        usage_hints = [str(value).strip() for value in intent.get("usage_hints", []) if str(value).strip()]
        if usage_hints:
            usage_norm = self._normalize_text(item.usage)
            if any(
                self._normalize_text(value) == usage_norm
                or self._normalize_text(value) in usage_norm
                or usage_norm in self._normalize_text(value)
                for value in usage_hints
            ):
                boost += 0.10
                chips.append("Occasion aligned")

        season_hints = [str(value).strip() for value in intent.get("season_hints", []) if str(value).strip()]
        if season_hints:
            season_norm = self._normalize_text(item.season)
            if any(self._normalize_text(value) == season_norm for value in season_hints):
                boost += 0.08
                chips.append("Season aligned")

        style_keywords = [str(value).strip() for value in intent.get("style_keywords", []) if str(value).strip()]
        if style_keywords:
            product_blob = self._normalize_text(" ".join([item.name, item.article_type, item.base_colour, item.usage]))
            if any(self._normalize_text(keyword) in product_blob for keyword in style_keywords):
                boost += 0.06
                chips.append("Style keyword match")

        if self.prefer_newest and item.year is not None:
            recency = max(0.0, min(1.0, (float(item.year) - 2008.0) / 20.0))
            boost += recency * 0.05
            if recency >= 0.6:
                chips.append("Recent collection")

        return boost, self._dedupe(chips)

    def _retrieve_ranked(
        self,
        *,
        query_text: str,
        intent: dict[str, Any],
        top_k: int,
        deadline: float | None,
        exclude_product_ids: set[int] | None = None,
        dense_build_if_missing: bool = True,
        rerank_depth_multiplier: int = 8,
        candidate_pool_limit: int | None = None,
        rerank_candidate_limit: int | None = None,
    ) -> tuple[list[tuple[int, float]], bool, dict[int, list[str]]]:
        exclude_ids = exclude_product_ids or set()
        pool_size = max(self.search_candidate_pool, top_k * 20)
        if candidate_pool_limit is not None:
            pool_size = max(top_k * 8, min(pool_size, max(int(candidate_pool_limit), top_k * 8)))

        lexical_rows = self._lexical_candidate_rows(query_text, pool_size=pool_size)
        dense_rows: list[int] = []
        if self.ai_enabled:
            try:
                dense_rows = self._dense_candidate_rows(
                    query_text,
                    pool_size=pool_size,
                    deadline=deadline,
                    build_if_missing=dense_build_if_missing,
                )
            except Exception:
                _LOGGER.warning("Dense retrieval unavailable for this request; continuing with lexical candidates.")

        fused_rows = self._rrf_fuse(
            [lexical_rows, dense_rows],
            limit=max(pool_size, top_k * 30),
        )
        if not fused_rows:
            fused_rows = lexical_rows

        if not fused_rows:
            fallback = self._random_recommendations(top_k, exclude_product_ids=exclude_ids)
            reasons = {pid: ["Fallback feed"] for pid, _ in fallback}
            return fallback, False, reasons

        rerank_rows = fused_rows
        if rerank_candidate_limit is not None:
            capped = max(top_k, int(rerank_candidate_limit))
            rerank_rows = fused_rows[:capped]

        ranked_rows, rerank_ai_used = self._rank_query_candidates(
            query_text,
            rerank_rows,
            top_k=max(top_k * max(2, int(rerank_depth_multiplier)), top_k),
            deadline=deadline,
        )

        lexical_set = set(lexical_rows)
        dense_set = set(dense_rows)

        scored: list[tuple[int, float, list[str]]] = []
        for row_idx, base_score in ranked_rows:
            item = self.index.items[row_idx]
            if item.id in exclude_ids:
                continue

            boost, business_chips = self._business_adjustment(intent, item)
            chips: list[str] = []
            if row_idx in lexical_set:
                chips.append("Keyword relevance")
            if row_idx in dense_set:
                chips.append("Semantic similarity")
            if rerank_ai_used:
                chips.append("Cohere rerank")
            chips.extend(business_chips)

            scored.append((item.id, float(base_score) + boost, self._dedupe(chips)))

        if not scored:
            fallback = self._random_recommendations(top_k, exclude_product_ids=exclude_ids)
            reasons = {pid: ["Fallback feed"] for pid, _ in fallback}
            return fallback, False, reasons

        scored.sort(key=lambda item: item[1], reverse=True)
        top_scored = scored[:top_k]

        ranked = [(product_id, score) for product_id, score, _chips in top_scored]
        reasons = {
            product_id: (chips[:4] if chips else ["Catalog relevance"])
            for product_id, _score, chips in top_scored
        }
        return ranked, bool(dense_rows or rerank_ai_used), reasons

    def _random_recommendations(
        self,
        top_k: int,
        *,
        exclude_product_ids: set[int] | None = None,
    ) -> list[tuple[int, float]]:
        exclude_ids = exclude_product_ids or set()
        rows = self.db.list_random_products(max(top_k * 3, top_k + 4))
        out: list[tuple[int, float]] = []
        for row in rows:
            product_id = int(row["id"])
            if product_id in exclude_ids:
                continue
            out.append((product_id, 0.0))
            if len(out) >= top_k:
                break
        return out

    def _build_public_product(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": int(row["id"]),
            "name": row["name"],
            "gender": row["gender"],
            "master_category": row["master_category"],
            "sub_category": row["sub_category"],
            "article_type": row["article_type"],
            "base_colour": row["base_colour"],
            "season": row["season"],
            "year": row["year"],
            "usage": row["usage"],
            "image_url": f"/api/image/{int(row['id'])}",
        }

    def _store_session_results(
        self,
        *,
        shopper_name: str,
        source: str,
        query_text: str | None,
        image_summary: dict[str, Any] | None,
        ranked: list[tuple[int, float]],
        reasons: dict[int, list[str]],
        assistant_note: str,
        ai_powered: bool,
    ) -> dict[str, Any]:
        session_id = self.db.create_session(
            shopper_name=shopper_name,
            source=source,
            query_text=query_text,
            image_summary=json.dumps(image_summary) if image_summary is not None else None,
        )
        self.db.store_recommendations(session_id, ranked)
        self._session_explanations[session_id] = reasons

        payload = self.get_personalized(session_id)
        payload["assistant_note"] = assistant_note
        payload["ai_powered"] = ai_powered
        return payload

    def home_feed(self, *, limit: int = 24, gender: str | None = None) -> list[dict[str, Any]]:
        rows = self.db.list_random_products(limit, gender=gender)
        return [self._build_public_product(row) for row in rows]

    def create_suggest_session(
        self,
        *,
        product_id: int,
        shopper_name: str = "GlobalMart Fashion Shopper",
    ) -> dict[str, Any]:
        safe_shopper = shopper_name.strip() or self.default_shopper_name
        self.db.ensure_shopper_profile(safe_shopper)

        anchor = self.db.get_product(int(product_id))
        if not anchor:
            raise KeyError("Product not found.")

        quick_query = " ".join(
            value
            for value in [
                str(anchor.get("gender") or "").strip(),
                str(anchor.get("usage") or "").strip(),
                str(anchor.get("base_colour") or "").strip(),
                str(anchor.get("article_type") or "").strip(),
                "complete look",
            ]
            if value
        )

        session_id = self.db.create_session(
            shopper_name=safe_shopper,
            source="home-suggest-anchor",
            query_text=quick_query or None,
            image_summary=json.dumps({"anchor_product_id": int(product_id)}),
        )
        return {
            "session_id": session_id,
            "anchor_product": self._build_public_product(anchor),
            "assistant_note": "Quick suggest session created from the selected catalog item.",
        }

    def _ensure_transcriber(self):
        if self._transcriber is not None:
            return self._transcriber
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "Backend voice transcription is unavailable. Install faster-whisper or use browser speech input."
            ) from exc
        self._transcriber = WhisperModel(
            self._transcriber_name,
            device=self._transcriber_device,
            compute_type=self._transcriber_compute_type,
        )
        return self._transcriber

    def transcribe_voice(self, *, audio_bytes: bytes, filename: str | None = None) -> dict[str, Any]:
        if not audio_bytes:
            raise ValueError("Audio payload is empty.")
        suffix = Path(filename or "voice.webm").suffix or ".webm"
        model = self._ensure_transcriber()

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            segments, _info = model.transcribe(tmp_path, vad_filter=True, language="en")
            text = " ".join(segment.text.strip() for segment in segments if getattr(segment, "text", "").strip()).strip()
        except Exception as exc:
            raise RuntimeError(f"Voice transcription failed: {exc}") from exc
        finally:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass

        if not text:
            raise ValueError("No speech detected from audio input.")
        return {
            "text": text,
            "engine": "faster-whisper",
            "model": self._transcriber_name,
        }

    def search_by_text(
        self,
        *,
        query: str,
        shopper_name: str = "GlobalMart Fashion Shopper",
        top_k: int = 10,
    ) -> dict[str, Any]:
        cleaned = query.strip()
        if not cleaned:
            raise ValueError("Please enter a search query.")

        safe_shopper = shopper_name.strip() or self.default_shopper_name
        self.db.ensure_shopper_profile(safe_shopper)

        deadline = time.monotonic() + self.search_timeout_seconds if self.ai_enabled else None
        try:
            intent = self._extract_intent(cleaned, image_summary=None, deadline=deadline)
            ranked, ai_powered, reasons = self._retrieve_ranked(
                query_text=cleaned,
                intent=intent,
                top_k=top_k,
                deadline=deadline,
            )
            if not ranked:
                ranked = self._random_recommendations(top_k)
                reasons = {pid: ["Fallback feed"] for pid, _ in ranked}

            if ai_powered:
                note = (
                    "GlobalMart Fashion AI powered by Cohere generated these recommendations from your search intent."
                )
            elif self.ai_enabled:
                note = "Cohere AI fallback mode used lexical ranking for this search."
            else:
                note = "COHERE_API_KEY is not configured. Showing lexical fallback ranking for local testing."
        except Exception:
            _LOGGER.warning("Falling back to random recommendations for text search due to retrieval failure.")
            ranked = self._random_recommendations(top_k)
            reasons = {pid: ["Fallback feed"] for pid, _ in ranked}
            note = "Search ranking is unavailable right now. Showing fallback recommendations so you can continue."
            ai_powered = False

        return self._store_session_results(
            shopper_name=safe_shopper,
            source="natural-language-query-search",
            query_text=cleaned,
            image_summary=None,
            ranked=ranked,
            reasons=reasons,
            assistant_note=note,
            ai_powered=ai_powered,
        )

    def search_by_image(
        self,
        *,
        image_bytes: bytes,
        shopper_name: str = "GlobalMart Fashion Shopper",
        top_k: int = 10,
    ) -> dict[str, Any]:
        safe_shopper = shopper_name.strip() or self.default_shopper_name
        self.db.ensure_shopper_profile(safe_shopper)

        ai_powered = False
        if self.ai_enabled:
            deadline = time.monotonic() + self.image_timeout_seconds
            try:
                client = self._ensure_client()
                analysis = self._run_with_timeout(
                    "Vision analysis request",
                    lambda: analyze_outfit_image(
                        client=client,
                        image_bytes=image_bytes,
                        article_types=self.article_types,
                        model=self.cfg.vision_model,
                    ),
                    min(self.request_timeout_seconds, self._remaining_timeout(deadline)),
                )

                query_parts = [
                    str(value).strip()
                    for value in analysis.get("search_queries", [])
                    if isinstance(value, str) and str(value).strip()
                ]
                if len(query_parts) > 2:
                    query_parts = query_parts[:2]
                if not query_parts:
                    query_parts = [
                        " ".join(
                            [
                                str(analysis.get("gender", "")),
                                str(analysis.get("occasion", "")),
                                " ".join(analysis.get("colors", [])),
                                " ".join(analysis.get("article_types", [])),
                            ]
                        ).strip()
                    ]

                combined_query = "; ".join([part for part in query_parts if part]) or "fashion outfit recommendations"
                # Image flow already has structured vision signals; avoid extra intent LLM call for latency.
                intent = self._heuristic_intent(combined_query, image_summary=analysis)
                ranked, ranking_ai_powered, reasons = self._retrieve_ranked(
                    query_text=combined_query,
                    intent=intent,
                    top_k=top_k,
                    deadline=deadline,
                    dense_build_if_missing=False,
                    rerank_depth_multiplier=2,
                    candidate_pool_limit=max(top_k * 6, 60),
                    rerank_candidate_limit=max(top_k * 4, 40),
                )
                if not ranked:
                    ranked = self._random_recommendations(top_k)
                    reasons = {pid: ["Fallback feed"] for pid, _ in ranked}

                ai_powered = bool(ranking_ai_powered)
                if ranking_ai_powered:
                    note = "GlobalMart Fashion AI powered by Cohere analyzed your image and ranked similar products."
                else:
                    note = "Cohere vision analyzed your image and lexical fallback ranked the final products."
            except Exception:
                _LOGGER.warning("Falling back to random recommendations for image search due to service unavailability.")
                analysis = {
                    "error": "cohere_unavailable",
                    "search_queries": [],
                }
                ranked = self._random_recommendations(top_k)
                reasons = {pid: ["Fallback feed"] for pid, _ in ranked}
                note = "Image analysis is unavailable right now. Showing fallback recommendations so you can continue."
        else:
            analysis = {
                "error": "COHERE_API_KEY not configured",
                "search_queries": [],
            }
            ranked = self._random_recommendations(top_k)
            reasons = {pid: ["Fallback feed"] for pid, _ in ranked}
            note = "Cohere key missing, so image flow returned fallback recommendations."

        payload = self._store_session_results(
            shopper_name=safe_shopper,
            source="image-upload-match",
            query_text=None,
            image_summary=analysis,
            ranked=ranked,
            reasons=reasons,
            assistant_note=note,
            ai_powered=ai_powered,
        )
        payload["image_analysis"] = analysis
        return payload

    def _fallback_recommendation_chips(self, session: dict[str, Any], row: dict[str, Any]) -> list[str]:
        intent = self._intent_from_session(session)
        item = CatalogItem(
            id=int(row["id"]),
            gender=str(row["gender"]),
            master_category=str(row["master_category"]),
            sub_category=str(row["sub_category"]),
            article_type=str(row["article_type"]),
            base_colour=str(row["base_colour"]),
            season=str(row.get("season") or ""),
            year=row.get("year") if isinstance(row.get("year"), int) else None,
            usage=str(row.get("usage") or ""),
            name=str(row["name"]),
        )
        _boost, chips = self._business_adjustment(intent, item)
        if not chips:
            chips = ["Catalog relevance"]
        return chips[:4]

    def get_personalized(self, session_id: str) -> dict[str, Any]:
        session = self.db.get_session(session_id)
        if not session:
            raise KeyError("Recommendation session not found.")

        rows = self.db.get_recommendations(session_id)
        explanations = self._session_explanations.get(session_id, {})

        products: list[dict[str, Any]] = []
        for row in rows:
            product = self._build_public_product(row)
            product_id = int(row["id"])
            product["rank"] = int(row["rank_position"])
            product["score"] = float(row["score"])
            chips = explanations.get(product_id) or self._fallback_recommendation_chips(session, row)
            product["explanation_chips"] = chips
            product["explanation"] = " | ".join(chips)
            if row.get("match_verdict"):
                product["match"] = {
                    "verdict": row["match_verdict"],
                    "rationale": row["match_rationale"],
                    "confidence": row["match_confidence"],
                }
            products.append(product)

        return {
            "session": session,
            "recommendations": products,
        }

    def _match_score(self, intent: dict[str, Any], product: dict[str, Any]) -> tuple[str, str, float]:
        item = CatalogItem(
            id=int(product["id"]),
            gender=str(product["gender"]),
            master_category=str(product["master_category"]),
            sub_category=str(product["sub_category"]),
            article_type=str(product["article_type"]),
            base_colour=str(product["base_colour"]),
            season=str(product.get("season") or ""),
            year=product.get("year") if isinstance(product.get("year"), int) else None,
            usage=str(product.get("usage") or ""),
            name=str(product["name"]),
        )
        boost, chips = self._business_adjustment(intent, item)
        confidence = max(0.2, min(0.95, 0.55 + boost))

        if confidence >= 0.82:
            verdict = "Strong match"
        elif confidence >= 0.7:
            verdict = "Good match"
        elif confidence >= 0.55:
            verdict = "Possible match"
        else:
            verdict = "Weak match"

        rationale = "Signals: " + ", ".join(chips[:4] if chips else ["limited metadata alignment"])
        return verdict, rationale, round(confidence, 2)

    def check_match(self, *, session_id: str, product_id: int) -> dict[str, Any]:
        session = self.db.get_session(session_id)
        if not session:
            raise KeyError("Recommendation session not found.")

        product = self.db.get_product(product_id)
        if not product:
            raise KeyError("Product not found.")

        intent = self._intent_from_session(session)
        heuristic_verdict, heuristic_rationale, heuristic_confidence = self._match_score(intent, product)

        ai_powered = False
        if self.ai_enabled:
            client = self._ensure_client()
            prompt = (
                "You are GlobalMart Fashion's Outfit Assistant.\n"
                "Evaluate if the recommended product is a good match for this shopper intent.\n"
                "Return JSON only with keys: verdict, rationale, confidence.\n"
                "verdict must be one of: Strong match, Good match, Possible match, Weak match.\n"
                "confidence must be a number between 0 and 1.\n\n"
                f"SESSION_SOURCE: {session.get('source')}\n"
                f"SHOPPER_NAME: {session.get('shopper_name')}\n"
                f"SHOPPER_QUERY: {session.get('query_text')}\n"
                f"IMAGE_SUMMARY_JSON: {session.get('image_summary')}\n\n"
                "PRODUCT:\n"
                f"- id: {product['id']}\n"
                f"- name: {product['name']}\n"
                f"- gender: {product['gender']}\n"
                f"- article_type: {product['article_type']}\n"
                f"- base_colour: {product['base_colour']}\n"
                f"- usage: {product['usage']}\n"
                f"- season: {product['season']}\n"
                f"- year: {product['year']}\n"
            )
            try:
                parsed = self._run_with_timeout(
                    "Match scoring request",
                    lambda: llm_match_judgement(client=client, prompt=prompt, model=self.cfg.chat_model),
                    self.match_timeout_seconds,
                )
                verdict = str(parsed.get("verdict", heuristic_verdict))
                llm_rationale = str(parsed.get("rationale", heuristic_rationale)).strip()
                confidence = float(parsed.get("confidence", heuristic_confidence))
                ai_powered = True
                rationale = f"{llm_rationale} Heuristic check: {heuristic_rationale}".strip()
            except Exception:
                _LOGGER.warning("Match scoring fell back to heuristic mode.")
                verdict = heuristic_verdict
                rationale = heuristic_rationale
                confidence = heuristic_confidence
        else:
            verdict = heuristic_verdict
            rationale = heuristic_rationale
            confidence = heuristic_confidence

        self.db.store_match_check(
            session_id=session_id,
            product_id=product_id,
            verdict=verdict,
            rationale=rationale,
            confidence=confidence,
        )
        self.record_feedback(
            shopper_name=str(session.get("shopper_name") or self.default_shopper_name),
            event_type="match_check",
            session_id=session_id,
            product_id=product_id,
            event_value=verdict,
        )

        return {
            "session_id": session_id,
            "product_id": product_id,
            "verdict": verdict,
            "rationale": rationale,
            "confidence": confidence,
            "ai_powered": ai_powered,
            "judgement_details": {
                "verdict": heuristic_verdict,
                "confidence": heuristic_confidence,
                "rationale": heuristic_rationale,
            },
        }

    def _refresh_profile_preferences(self, shopper_name: str) -> None:
        preferred_gender = self.db.get_top_attribute_for_shopper(shopper_name=shopper_name, attribute="gender")
        favorite_color = self.db.get_top_attribute_for_shopper(shopper_name=shopper_name, attribute="base_colour")
        favorite_article_type = self.db.get_top_attribute_for_shopper(
            shopper_name=shopper_name,
            attribute="article_type",
        )
        self.db.update_profile_preferences(
            shopper_name=shopper_name,
            preferred_gender=preferred_gender,
            favorite_color=favorite_color,
            favorite_article_type=favorite_article_type,
        )

    def get_profile(self, shopper_name: str = "GlobalMart Fashion Shopper") -> dict[str, Any]:
        safe_shopper = shopper_name.strip() or self.default_shopper_name
        self.db.ensure_shopper_profile(safe_shopper)
        self._refresh_profile_preferences(safe_shopper)

        profile = self.db.get_profile(safe_shopper)
        if not profile:
            raise KeyError("Shopper profile not found.")

        cart = self.get_cart(safe_shopper)
        return {
            "shopper_name": profile["shopper_name"],
            "membership_tier": profile["membership_tier"],
            "preferred_gender": profile.get("preferred_gender") or "Unspecified",
            "favorite_color": profile.get("favorite_color") or "Unspecified",
            "favorite_article_type": profile.get("favorite_article_type") or "Unspecified",
            "click_events": int(profile.get("click_events") or 0),
            "cart_add_events": int(profile.get("cart_add_events") or 0),
            "cart_items": int(cart.get("total_items") or 0),
            "updated_at": profile.get("updated_at"),
        }

    def get_cart(self, shopper_name: str = "GlobalMart Fashion Shopper") -> dict[str, Any]:
        safe_shopper = shopper_name.strip() or self.default_shopper_name
        self.db.ensure_shopper_profile(safe_shopper)
        rows = self.db.get_cart_items(safe_shopper)

        items: list[dict[str, Any]] = []
        total_items = 0
        for row in rows:
            quantity = int(row.get("quantity") or 0)
            total_items += quantity
            item = self._build_public_product(row)
            item["quantity"] = quantity
            items.append(item)

        return {
            "shopper_name": safe_shopper,
            "total_items": total_items,
            "items": items,
        }

    def add_to_cart(
        self,
        *,
        shopper_name: str = "GlobalMart Fashion Shopper",
        product_id: int,
        quantity: int = 1,
    ) -> dict[str, Any]:
        safe_shopper = shopper_name.strip() or self.default_shopper_name
        self.db.ensure_shopper_profile(safe_shopper)
        product = self.db.get_product(product_id)
        if not product:
            raise KeyError("Product not found.")

        safe_quantity = max(1, min(int(quantity), 10))
        self.db.add_cart_item(shopper_name=safe_shopper, product_id=int(product_id), quantity=safe_quantity)

        self.record_feedback(
            shopper_name=safe_shopper,
            event_type="cart_add",
            session_id=None,
            product_id=int(product_id),
            event_value=str(safe_quantity),
        )
        return self.get_cart(safe_shopper)

    def remove_from_cart(
        self,
        *,
        shopper_name: str = "GlobalMart Fashion Shopper",
        product_id: int,
    ) -> dict[str, Any]:
        safe_shopper = shopper_name.strip() or self.default_shopper_name
        self.db.ensure_shopper_profile(safe_shopper)
        self.db.remove_cart_item(shopper_name=safe_shopper, product_id=int(product_id))
        return self.get_cart(safe_shopper)

    def record_feedback(
        self,
        *,
        shopper_name: str = "GlobalMart Fashion Shopper",
        event_type: str,
        session_id: str | None = None,
        product_id: int | None = None,
        event_value: str | None = None,
    ) -> dict[str, Any]:
        safe_shopper = shopper_name.strip() or self.default_shopper_name
        safe_event = event_type.strip().lower()
        if safe_event not in {"click", "cart_add", "match_check", "complete_look", "refine"}:
            raise ValueError("event_type must be one of: click, cart_add, match_check, complete_look, refine")

        self.db.ensure_shopper_profile(safe_shopper)
        if product_id is not None and not self.db.get_product(int(product_id)):
            raise KeyError("Product not found.")

        self.db.record_feedback(
            shopper_name=safe_shopper,
            event_type=safe_event,
            session_id=session_id,
            product_id=int(product_id) if product_id is not None else None,
            event_value=event_value,
        )

        if safe_event in {"click", "cart_add"}:
            self.db.increment_profile_event_counter(shopper_name=safe_shopper, event_type=safe_event)
            self._refresh_profile_preferences(safe_shopper)

        return {"status": "ok", "event_type": safe_event}

    def footer_content(self, slug: str) -> dict[str, Any]:
        key = slug.strip().lower()
        if key not in _FOOTER_CONTENT:
            raise KeyError("Content page not found.")
        title, body = _FOOTER_CONTENT[key]
        return {"slug": key, "title": title, "body": body}

    def _complete_look_query(self, anchor: dict[str, Any], intent: dict[str, Any]) -> str:
        article_norm = self._normalize_text(anchor.get("article_type") or "")
        complement = "outfit pieces"
        for key, value in _COMPLEMENTARY_HINTS.items():
            if key in article_norm:
                complement = value
                break

        usage_hint = ""
        usage_hints = [str(value).strip() for value in intent.get("usage_hints", []) if str(value).strip()]
        if usage_hints:
            usage_hint = usage_hints[0]
        elif anchor.get("usage"):
            usage_hint = str(anchor.get("usage"))

        return " ".join(
            part
            for part in [
                str(anchor.get("gender") or ""),
                usage_hint,
                str(anchor.get("base_colour") or ""),
                "complete look",
                str(anchor.get("article_type") or ""),
                complement,
            ]
            if str(part).strip()
        )

    def _complete_look_complement_tokens(self, anchor_article_type: str) -> set[str]:
        article_norm = self._normalize_text(anchor_article_type)
        complement = "outfit pieces"
        for key, value in _COMPLEMENTARY_HINTS.items():
            if key in article_norm:
                complement = value
                break
        tokens = set(self._tokenize(complement))
        return {token for token in tokens if len(token) >= 3}

    def _diversify_complete_look_candidates(
        self,
        *,
        ranked: list[tuple[int, float]],
        anchor: dict[str, Any],
        top_k: int,
    ) -> list[tuple[dict[str, Any], float]]:
        anchor_article_norm = self._normalize_text(anchor.get("article_type") or "")
        anchor_master_norm = self._normalize_text(anchor.get("master_category") or "")
        complement_tokens = self._complete_look_complement_tokens(str(anchor.get("article_type") or ""))

        staged: list[dict[str, Any]] = []
        for product_id, score in ranked:
            row = self.db.get_product(int(product_id))
            if not row:
                continue

            article_norm = self._normalize_text(row.get("article_type") or "")
            is_different_article = bool(article_norm and article_norm != anchor_article_norm)
            master_norm = self._normalize_text(row.get("master_category") or "")
            is_different_master = bool(master_norm and anchor_master_norm and master_norm != anchor_master_norm)
            article_blob = self._normalize_text(
                " ".join(
                    [
                        str(row.get("article_type") or ""),
                        str(row.get("sub_category") or ""),
                        str(row.get("master_category") or ""),
                    ]
                )
            )
            complement_match = any(token in article_blob for token in complement_tokens)
            adjusted = (
                float(score)
                + (0.24 if is_different_article else -0.05)
                + (0.18 if complement_match else 0.0)
                + (0.09 if is_different_master else 0.0)
            )
            staged.append(
                {
                    "row": row,
                    "score": float(score),
                    "adjusted": adjusted,
                    "article_norm": article_norm,
                    "master_norm": master_norm,
                    "different_article": is_different_article,
                    "different_master": is_different_master,
                    "complement_match": complement_match,
                    "product_id": int(product_id),
                }
            )

        if not staged:
            return []

        staged.sort(key=lambda item: item["adjusted"], reverse=True)
        selected: list[tuple[dict[str, Any], float]] = []
        selected_ids: set[int] = set()
        used_article_types: set[str] = {anchor_article_norm} if anchor_article_norm else set()

        def try_select(*, require_different: bool, require_complement: bool, unique_article_type: bool) -> None:
            if len(selected) >= top_k:
                return
            for item in staged:
                if len(selected) >= top_k:
                    break
                product_id = int(item["product_id"])
                if product_id in selected_ids:
                    continue
                if require_different and not bool(item["different_article"]):
                    continue
                if require_complement and not bool(item["complement_match"]):
                    continue
                article_norm = str(item["article_norm"] or "")
                if unique_article_type and article_norm and article_norm in used_article_types:
                    continue

                selected.append((item["row"], float(item["score"])))
                selected_ids.add(product_id)
                if article_norm:
                    used_article_types.add(article_norm)

        # Pass 1: prioritize complementary pieces with different article types.
        try_select(require_different=True, require_complement=True, unique_article_type=True)
        # Pass 2: ensure broad article-type diversity even without explicit complement token hits.
        try_select(require_different=True, require_complement=False, unique_article_type=True)
        # Pass 3: fill with additional different article types.
        try_select(require_different=True, require_complement=True, unique_article_type=False)
        try_select(require_different=True, require_complement=False, unique_article_type=False)
        # Pass 4: fallback to any remaining high-score items if list is still short.
        try_select(require_different=False, require_complement=False, unique_article_type=False)

        return selected[:top_k]

    @staticmethod
    def _merge_ranked_candidates(
        primary: list[tuple[int, float]],
        secondary: list[tuple[int, float]],
        *,
        secondary_boost: float = 0.03,
    ) -> list[tuple[int, float]]:
        merged: dict[int, float] = {}
        for product_id, score in primary:
            merged[int(product_id)] = max(float(score), merged.get(int(product_id), float("-inf")))
        for product_id, score in secondary:
            boosted = float(score) + secondary_boost
            merged[int(product_id)] = max(boosted, merged.get(int(product_id), float("-inf")))
        return sorted(merged.items(), key=lambda item: item[1], reverse=True)

    def _supplement_complete_look_candidates(
        self,
        *,
        anchor: dict[str, Any],
        intent: dict[str, Any],
        exclude_product_ids: set[int],
        limit: int,
    ) -> list[tuple[int, float]]:
        complement_tokens = self._complete_look_complement_tokens(str(anchor.get("article_type") or ""))
        if not complement_tokens:
            return []

        anchor_article_norm = self._normalize_text(anchor.get("article_type") or "")
        anchor_master_norm = self._normalize_text(anchor.get("master_category") or "")
        expected_gender_norm = self._normalize_text(intent.get("gender") or anchor.get("gender") or "")

        candidates: list[tuple[int, float]] = []
        for item in self.index.items:
            if int(item.id) in exclude_product_ids:
                continue

            item_gender_norm = self._normalize_text(item.gender)
            if expected_gender_norm and item_gender_norm and item_gender_norm != expected_gender_norm:
                continue

            item_article_norm = self._normalize_text(item.article_type)
            if item_article_norm == anchor_article_norm:
                continue

            article_blob = self._normalize_text(f"{item.article_type} {item.sub_category} {item.master_category}")
            if not any(token in article_blob for token in complement_tokens):
                continue

            item_master_norm = self._normalize_text(item.master_category)
            score = 0.45
            if item_master_norm and anchor_master_norm and item_master_norm != anchor_master_norm:
                score += 0.12
            if item.year is not None:
                recency = max(0.0, min(1.0, (float(item.year) - 2008.0) / 20.0))
                score += recency * 0.06

            candidates.append((int(item.id), score))

        candidates.sort(key=lambda item: item[1], reverse=True)
        return candidates[: max(1, limit)]

    def _complete_look_reason(
        self,
        *,
        anchor: dict[str, Any],
        candidate: dict[str, Any],
        intent: dict[str, Any],
    ) -> str:
        reasons: list[str] = []

        anchor_article = str(anchor.get("article_type") or "").strip()
        candidate_article = str(candidate.get("article_type") or "").strip()
        if anchor_article and candidate_article:
            if self._normalize_text(anchor_article) != self._normalize_text(candidate_article):
                reasons.append(
                    f"adds a complementary {candidate_article.lower()} to your {anchor_article.lower()}"
                )
            else:
                reasons.append(f"keeps the same {candidate_article.lower()} style direction")

        anchor_color = str(anchor.get("base_colour") or "").strip()
        candidate_color = str(candidate.get("base_colour") or "").strip()
        color_hints = [str(value).strip() for value in intent.get("color_hints", []) if str(value).strip()]
        if candidate_color:
            if anchor_color and self._normalize_text(anchor_color) == self._normalize_text(candidate_color):
                reasons.append(f"matches your selected {candidate_color.lower()} color tone")
            elif any(self._normalize_text(value) == self._normalize_text(candidate_color) for value in color_hints):
                reasons.append(f"fits your color preference for {candidate_color.lower()}")

        usage_hints = [str(value).strip() for value in intent.get("usage_hints", []) if str(value).strip()]
        anchor_usage = str(anchor.get("usage") or "").strip()
        candidate_usage = str(candidate.get("usage") or "").strip()
        usage_target = usage_hints[0] if usage_hints else anchor_usage
        if usage_target and candidate_usage:
            if self._normalize_text(usage_target) == self._normalize_text(candidate_usage):
                reasons.append(f"fits the {candidate_usage.lower()} occasion from your request")

        if not reasons:
            reasons.append("fits the selected look profile")

        reason_text = "; ".join(reasons[:2])
        return f"Suggested because it {reason_text}."

    def complete_the_look(
        self,
        *,
        session_id: str,
        product_id: int,
        top_k: int = 6,
    ) -> dict[str, Any]:
        session = self.db.get_session(session_id)
        if not session:
            raise KeyError("Recommendation session not found.")

        anchor = self.db.get_product(product_id)
        if not anchor:
            raise KeyError("Product not found.")

        intent = self._intent_from_session(session)
        intent["gender"] = intent.get("gender") or str(anchor.get("gender") or "")
        intent["color_hints"] = self._dedupe(list(intent.get("color_hints", [])) + [str(anchor.get("base_colour") or "")])

        query = self._complete_look_query(anchor, intent)
        deadline = time.monotonic() + self.search_timeout_seconds if self.ai_enabled else None
        retrieval_top_k = max(24, max(1, top_k) * 8)
        ranked_primary, ai_powered, reasons = self._retrieve_ranked(
            query_text=query,
            intent=intent,
            top_k=retrieval_top_k,
            deadline=deadline,
            exclude_product_ids={int(product_id)},
        )
        ranked = list(ranked_primary)

        complement_tokens = self._complete_look_complement_tokens(str(anchor.get("article_type") or ""))
        if complement_tokens:
            usage_hints = [str(value).strip() for value in intent.get("usage_hints", []) if str(value).strip()]
            secondary_query = " ".join(
                part
                for part in [
                    str(anchor.get("gender") or ""),
                    usage_hints[0] if usage_hints else str(anchor.get("usage") or ""),
                    str(anchor.get("base_colour") or ""),
                    " ".join(sorted(complement_tokens)),
                    "outfit recommendation",
                ]
                if str(part).strip()
            )

            secondary_ranked, secondary_ai_powered, secondary_reasons = self._retrieve_ranked(
                query_text=secondary_query,
                intent=intent,
                top_k=retrieval_top_k,
                deadline=deadline,
                exclude_product_ids={int(product_id)},
            )
            ai_powered = bool(ai_powered or secondary_ai_powered)
            ranked = self._merge_ranked_candidates(ranked_primary, secondary_ranked)
            for key, value in secondary_reasons.items():
                existing = reasons.get(int(key), [])
                reasons[int(key)] = self._dedupe(list(existing) + list(value))

        supplemental = self._supplement_complete_look_candidates(
            anchor=anchor,
            intent=intent,
            exclude_product_ids={int(product_id)},
            limit=retrieval_top_k,
        )
        if supplemental:
            ranked = self._merge_ranked_candidates(ranked, supplemental, secondary_boost=0.08)
            for candidate_id, _score in supplemental:
                existing = reasons.get(int(candidate_id), [])
                reasons[int(candidate_id)] = self._dedupe(list(existing) + ["Complementary article type"])

        selected = self._diversify_complete_look_candidates(
            ranked=ranked,
            anchor=anchor,
            top_k=max(1, top_k),
        )
        if not selected:
            selected = []
            for pid, score in ranked[: max(1, top_k)]:
                row = self.db.get_product(int(pid))
                if row:
                    selected.append((row, float(score)))

        recs: list[dict[str, Any]] = []
        for rank, (row, score) in enumerate(selected, start=1):
            pid = int(row["id"])
            product = self._build_public_product(row)
            chips = reasons.get(pid, ["Catalog relevance"])
            product["rank"] = rank
            product["score"] = score
            product["explanation_chips"] = chips
            product["explanation"] = self._complete_look_reason(
                anchor=anchor,
                candidate=row,
                intent=intent,
            )
            recs.append(product)

        self.record_feedback(
            shopper_name=str(session.get("shopper_name") or self.default_shopper_name),
            event_type="complete_look",
            session_id=session_id,
            product_id=product_id,
            event_value=f"top_k:{top_k}",
        )

        query_text = str(session.get("query_text") or "").strip()
        if query_text:
            note = (
                f'Complete-look suggestions are tuned to your query "{query_text}" and anchored on '
                f'{anchor.get("name", "the selected item")}, prioritizing complementary article types.'
            )
        else:
            note = (
                f'Complete-look suggestions are anchored on {anchor.get("name", "the selected item")} and selected '
                "for complementary article types, color, category, and occasion compatibility."
            )

        return {
            "session_id": session_id,
            "anchor_product": self._build_public_product(anchor),
            "assistant_note": note,
            "ai_powered": ai_powered,
            "recommendations": recs,
        }

    def refine_session(
        self,
        *,
        session_id: str,
        refinement: str,
        top_k: int = 10,
    ) -> dict[str, Any]:
        session = self.db.get_session(session_id)
        if not session:
            raise KeyError("Recommendation session not found.")

        refinement_map = {
            "party": "Party",
            "work": "Work",
            "casual": "Casual",
        }
        normalized_refinement = refinement_map.get(refinement.strip().lower())
        if not normalized_refinement:
            raise ValueError("refinement must be one of: party, work, casual")

        safe_shopper = str(session.get("shopper_name") or self.default_shopper_name)
        base_query = str(session.get("query_text") or "").strip()
        intent = self._intent_from_session(session)

        if not base_query:
            anchor_terms = [
                str(value).strip()
                for value in [
                    intent.get("gender") or "",
                    " ".join(intent.get("article_hints", [])),
                    " ".join(intent.get("color_hints", [])),
                ]
                if str(value).strip()
            ]
            base_query = " ".join(anchor_terms).strip() or "modern outfit"

        refined_query = f"{base_query} refined for {normalized_refinement}".strip()
        intent["usage_hints"] = self._dedupe(list(intent.get("usage_hints", [])) + [normalized_refinement])

        deadline = time.monotonic() + self.search_timeout_seconds if self.ai_enabled else None
        ranked, ai_powered, reasons = self._retrieve_ranked(
            query_text=refined_query,
            intent=intent,
            top_k=max(1, top_k),
            deadline=deadline,
        )
        if not ranked:
            ranked = self._random_recommendations(top_k)
            reasons = {pid: ["Fallback feed"] for pid, _ in ranked}

        payload = self._store_session_results(
            shopper_name=safe_shopper,
            source=f"session-refine-{normalized_refinement.lower()}",
            query_text=refined_query,
            image_summary=None,
            ranked=ranked,
            reasons=reasons,
            assistant_note=f"Session refined for {normalized_refinement.lower()} style.",
            ai_powered=ai_powered,
        )

        self.record_feedback(
            shopper_name=safe_shopper,
            event_type="refine",
            session_id=payload["session"]["session_id"],
            event_value=normalized_refinement,
        )
        payload["refinement"] = normalized_refinement.lower()
        return payload

    def image_path_for_product(self, product_id: int) -> Path | None:
        path = self.image_dir / f"{product_id}.jpg"
        if path.exists():
            return path
        return None

    def fallback_image_url(self, product_id: int) -> str:
        return _FALLBACK_IMAGE_PATH

    def stats(self) -> dict[str, Any]:
        details = self.db.stats()
        details["ai_enabled"] = self.ai_enabled
        details["catalog_items_in_memory"] = len(self.index.items)
        details["dense_index_ready"] = bool(self._dense_ready)
        details["embed_model"] = self.cfg.embed_model
        return details
