from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
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

    @classmethod
    def from_env(cls) -> "CohereConfig":
        return cls(
            chat_model=os.getenv("RN_CHAT_MODEL", "command-r-08-2024"),
            vision_model=os.getenv("RN_VISION_MODEL", "command-a-vision-07-2025"),
            rerank_model=os.getenv("RN_RERANK_MODEL", "rerank-v4.0-fast"),
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


def make_client() -> CohereClient:
    api_key = os.getenv("COHERE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("COHERE_API_KEY is not set.")
    timeout_seconds = _env_float("RN_COHERE_TIMEOUT_SECONDS", 20.0)
    max_retries = _env_int("RN_COHERE_MAX_RETRIES", 1)
    base_url = os.getenv("COHERE_API_BASE_URL", "https://api.cohere.com/v2").strip()
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
