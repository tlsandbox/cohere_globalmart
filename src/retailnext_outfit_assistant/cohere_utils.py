"""Cohere API helpers for chat/vision/rerank/embed and private endpoint config."""

from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except Exception:
        return default
    return value if value > 0 else default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except Exception:
        return default
    return value if value >= 0 else default


@dataclass(frozen=True)
class CohereConfig:
    chat_model: str
    vision_model: str
    rerank_model: str
    embed_model: str
    intent_model: str
    translate_model: str

    @classmethod
    def from_env(cls) -> "CohereConfig":
        return cls(
            chat_model=os.getenv("RN_CHAT_MODEL", "command-r-08-2024"),
            vision_model=os.getenv("RN_VISION_MODEL", "command-a-vision-07-2025"),
            rerank_model=os.getenv("RN_RERANK_MODEL", "rerank-v4.0-fast"),
            embed_model=os.getenv("RN_EMBED_MODEL", "embed-v4.0"),
            intent_model=os.getenv("RN_INTENT_MODEL", os.getenv("RN_CHAT_MODEL", "command-r-08-2024")),
            translate_model=os.getenv(
                "RN_TRANSLATE_MODEL",
                os.getenv("RN_INTENT_MODEL", os.getenv("RN_CHAT_MODEL", "command-r-08-2024")),
            ),
        )


class CohereClient:
    def __init__(self, *, api_key: str, base_url: str, timeout_seconds: float, max_retries: int) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = max(1.0, float(timeout_seconds))
        self.max_retries = max(0, int(max_retries))

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        endpoint = f"{self.base_url}{path}"
        request = urllib.request.Request(
            endpoint,
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                response_body = exc.read().decode("utf-8", errors="ignore")
                retryable = exc.code in {408, 409, 429, 500, 502, 503, 504}
                if retryable and attempt < self.max_retries:
                    time.sleep(0.4 * (2**attempt))
                    continue
                raise RuntimeError(
                    f"Cohere request failed ({exc.code}) at {path}: {response_body or exc.reason}"
                ) from exc
            except urllib.error.URLError as exc:
                last_error = exc
                if attempt < self.max_retries:
                    time.sleep(0.4 * (2**attempt))
                    continue
                raise RuntimeError(f"Cohere request failed at {path}: {exc.reason}") from exc

        raise RuntimeError(f"Cohere request failed at {path}: {last_error}")

    @staticmethod
    def _extract_chat_text(payload: dict[str, Any]) -> str:
        message = payload.get("message")
        if not isinstance(message, dict):
            return ""

        content = message.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for chunk in content:
                if isinstance(chunk, dict):
                    text = chunk.get("text")
                    if isinstance(text, str):
                        parts.append(text)
            return "\n".join(parts).strip()
        return ""

    @staticmethod
    def _extract_embeddings(payload: dict[str, Any]) -> list[list[float]]:
        embeddings = payload.get("embeddings")
        if isinstance(embeddings, list):
            out: list[list[float]] = []
            for row in embeddings:
                if isinstance(row, list):
                    try:
                        out.append([float(value) for value in row])
                    except Exception:
                        continue
            return out

        if isinstance(embeddings, dict):
            float_block = embeddings.get("float")
            if isinstance(float_block, list):
                out = []
                for row in float_block:
                    if isinstance(row, list):
                        try:
                            out.append([float(value) for value in row])
                        except Exception:
                            continue
                return out

            for value in embeddings.values():
                if isinstance(value, dict) and isinstance(value.get("float"), list):
                    out = []
                    for row in value.get("float", []):
                        if isinstance(row, list):
                            try:
                                out.append([float(v) for v in row])
                            except Exception:
                                continue
                    if out:
                        return out

        return []

    def chat_text(self, *, prompt: str, model: str, temperature: float = 0.2) -> str:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
        }
        response = self._post_json("/chat", payload)
        return self._extract_chat_text(response)

    def chat_image_text(
        self,
        *,
        prompt: str,
        image_bytes: bytes,
        model: str,
        temperature: float = 0.2,
    ) -> str:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                }
            ],
            "temperature": temperature,
        }
        response = self._post_json("/chat", payload)
        return self._extract_chat_text(response)

    def rerank(
        self,
        *,
        query: str,
        documents: list[str],
        model: str,
        top_n: int,
    ) -> list[tuple[int, float]]:
        if not documents:
            return []
        payload = {
            "model": model,
            "query": query,
            "documents": documents,
            "top_n": max(1, min(int(top_n), len(documents))),
        }
        response = self._post_json("/rerank", payload)
        results = response.get("results", [])
        ranked: list[tuple[int, float]] = []
        if isinstance(results, list):
            for row in results:
                if not isinstance(row, dict):
                    continue
                idx = row.get("index")
                score = row.get("relevance_score")
                if isinstance(idx, int):
                    try:
                        ranked.append((idx, float(score)))
                    except Exception:
                        continue
        return ranked

    def embed_texts(
        self,
        *,
        texts: list[str],
        model: str,
        input_type: str,
    ) -> list[list[float]]:
        cleaned = [str(text).strip() for text in texts if str(text).strip()]
        if not cleaned:
            return []

        primary_payload = {
            "model": model,
            "texts": cleaned,
            "input_type": input_type,
            "embedding_types": ["float"],
        }
        try:
            primary_response = self._post_json("/embed", primary_payload)
            vectors = self._extract_embeddings(primary_response)
            if len(vectors) == len(cleaned):
                return vectors
        except Exception:
            pass

        fallback_payload = {
            "model": model,
            "input_type": input_type,
            "embedding_types": ["float"],
            "inputs": [{"content": [{"type": "text", "text": text}]} for text in cleaned],
        }
        fallback_response = self._post_json("/embed", fallback_payload)
        vectors = self._extract_embeddings(fallback_response)
        if len(vectors) != len(cleaned):
            raise RuntimeError("Cohere embedding response shape mismatch.")
        return vectors


def _extract_json_block(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("Model returned an empty response.")

    if raw.startswith("```"):
        first_newline = raw.find("\n")
        last_fence = raw.rfind("```")
        if first_newline != -1 and last_fence > first_newline:
            raw = raw[first_newline:last_fence].strip()

    candidates = [raw]
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        candidates.append(raw[start : end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except Exception:
            continue
        if isinstance(parsed, dict):
            return parsed

    raise ValueError(f"Could not parse JSON object from model response: {text[:200]}")


def _load_private_endpoint_overrides() -> dict[str, Any]:
    config_path = os.getenv("RN_COHERE_CONFIG_PATH", "").strip()
    if not config_path:
        return {}

    path = Path(config_path)
    if not path.exists() or not path.is_file():
        return {}

    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    if not isinstance(parsed, dict):
        return {}
    return parsed


def make_client() -> CohereClient:
    overrides = _load_private_endpoint_overrides()

    api_key = os.getenv("COHERE_API_KEY", "").strip()
    if not api_key:
        api_key = str(overrides.get("api_key", "")).strip()
    if not api_key:
        raise RuntimeError("COHERE_API_KEY is not set.")

    timeout_seconds = _env_float("RN_COHERE_TIMEOUT_SECONDS", float(overrides.get("timeout_seconds", 20.0) or 20.0))
    max_retries = _env_int("RN_COHERE_MAX_RETRIES", int(overrides.get("max_retries", 1) or 1))
    base_url = os.getenv("COHERE_API_BASE_URL", "").strip() or str(
        overrides.get("base_url", "https://api.cohere.com/v2")
    ).strip()

    return CohereClient(
        api_key=api_key,
        base_url=base_url or "https://api.cohere.com/v2",
        timeout_seconds=timeout_seconds,
        max_retries=max_retries,
    )


def rerank_documents(
    client: CohereClient,
    *,
    query: str,
    documents: list[str],
    model: str,
    top_n: int,
) -> list[tuple[int, float]]:
    return client.rerank(query=query, documents=documents, model=model, top_n=top_n)


def embed_texts(
    client: CohereClient,
    *,
    texts: list[str],
    model: str,
    input_type: str,
) -> list[list[float]]:
    return client.embed_texts(texts=texts, model=model, input_type=input_type)


def extract_structured_intent(
    client: CohereClient,
    *,
    query_text: str,
    article_types: list[str],
    model: str,
) -> dict[str, Any]:
    prompt = (
        "You are the GlobalMart Fashion intent parser.\n"
        "Read the shopper query and output ONLY valid JSON with keys:\n"
        "- gender (Men|Women|Unisex|Unknown)\n"
        "- usage (Formal|Casual|Ethnic|Party|Sports|Work|Unknown)\n"
        "- article_types (array using only allowed values)\n"
        "- colors (array of 0-5 plain color words)\n"
        "- season (Summer|Winter|Spring|Fall|All|Unknown)\n"
        "- style_keywords (array of concise keywords)\n"
        f"Allowed article types: {article_types}\n"
        f"Query: {query_text}\n"
        "No markdown. No extra keys."
    )
    raw = client.chat_text(prompt=prompt, model=model, temperature=0.1)
    parsed = _extract_json_block(raw)

    allowed_lookup = {value.casefold(): value for value in article_types}
    normalized_article_types: list[str] = []
    for value in parsed.get("article_types", []) if isinstance(parsed.get("article_types"), list) else []:
        key = str(value).strip().casefold()
        if key in allowed_lookup:
            normalized_article_types.append(allowed_lookup[key])

    colors = [
        str(value).strip()
        for value in parsed.get("colors", [])
        if isinstance(value, str) and str(value).strip()
    ]
    style_keywords = [
        str(value).strip()
        for value in parsed.get("style_keywords", [])
        if isinstance(value, str) and str(value).strip()
    ]

    return {
        "gender": str(parsed.get("gender", "Unknown")).strip() or "Unknown",
        "usage": str(parsed.get("usage", "Unknown")).strip() or "Unknown",
        "article_types": normalized_article_types,
        "colors": colors,
        "season": str(parsed.get("season", "Unknown")).strip() or "Unknown",
        "style_keywords": style_keywords,
    }


def analyze_outfit_image(
    client: CohereClient,
    *,
    image_bytes: bytes,
    article_types: list[str],
    model: str,
) -> dict[str, Any]:
    prompt = (
        "You are the GlobalMart Fashion assistant.\n"
        "Analyze the uploaded outfit photo and output ONLY valid JSON with keys:\n"
        "- gender (Men|Women|Unisex|Unknown)\n"
        "- occasion (Formal|Casual|Ethnic|Party|Sports|Work|Unknown)\n"
        "- colors (array of 1-5 colors)\n"
        "- article_types (array using only allowed values)\n"
        "- search_queries (array of 3-6 short catalog queries)\n"
        f"Allowed article types: {article_types}\n"
        "No markdown. No explanations."
    )
    raw = client.chat_image_text(prompt=prompt, image_bytes=image_bytes, model=model, temperature=0.2)
    parsed = _extract_json_block(raw)

    normalized_article_types: list[str] = []
    allowed_lookup = {value.casefold(): value for value in article_types}
    for value in parsed.get("article_types", []) if isinstance(parsed.get("article_types"), list) else []:
        key = str(value).strip().casefold()
        if key in allowed_lookup:
            normalized_article_types.append(allowed_lookup[key])

    normalized_queries = [
        str(value).strip()
        for value in parsed.get("search_queries", [])
        if isinstance(value, str) and str(value).strip()
    ]
    normalized_colors = [
        str(value).strip()
        for value in parsed.get("colors", [])
        if isinstance(value, str) and str(value).strip()
    ]

    return {
        "gender": str(parsed.get("gender", "Unknown")).strip() or "Unknown",
        "occasion": str(parsed.get("occasion", "Unknown")).strip() or "Unknown",
        "colors": normalized_colors,
        "article_types": normalized_article_types,
        "search_queries": normalized_queries,
    }


def llm_match_judgement(
    client: CohereClient,
    *,
    prompt: str,
    model: str,
) -> dict[str, Any]:
    raw = client.chat_text(prompt=prompt, model=model, temperature=0.2)
    parsed = _extract_json_block(raw)
    confidence = parsed.get("confidence")
    try:
        confidence_value = float(confidence)
    except Exception:
        confidence_value = 0.5

    return {
        "verdict": str(parsed.get("verdict") or "Possible match").strip(),
        "rationale": str(parsed.get("rationale") or "Partial alignment with shopper intent.").strip(),
        "confidence": max(0.0, min(1.0, confidence_value)),
    }


def translate_text(
    client: CohereClient,
    *,
    text: str,
    target_language: str,
    model: str,
) -> str:
    prompt = (
        "You are a concise ecommerce translator.\n"
        f"Translate the text to {target_language}.\n"
        "Rules:\n"
        "- Keep brand names and product IDs unchanged.\n"
        "- Preserve meaning and tone.\n"
        "- Return plain text only.\n"
        f"Text: {text}"
    )
    return client.chat_text(prompt=prompt, model=model, temperature=0.1).strip()
