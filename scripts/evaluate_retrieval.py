#!/usr/bin/env python3
"""Runs retrieval quality/latency evaluation for baseline and upgraded ranking pipelines."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics
import sys
import time

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from dotenv import load_dotenv
from retailnext_outfit_assistant.service import OutfitAssistantService


DEFAULT_QUERIES = [
    "men casual navy shirt",
    "women party black dress",
    "work formal white shirt men",
    "casual sports shoes blue",
    "women ethnic kurta green",
    "summer t-shirt for men",
    "party look women red tops",
    "office wear trousers men",
    "casual flip flops brown",
    "women work blazer style",
]


def run_legacy(service: OutfitAssistantService, query: str, top_k: int):
    pool_size = max(service.search_candidate_pool, top_k * 20)
    lexical_rows = service._lexical_candidate_rows(query, pool_size=pool_size)
    deadline = time.monotonic() + service.search_timeout_seconds if service.ai_enabled else None
    ranked_rows, _ai_used = service._rank_query_candidates(
        query,
        lexical_rows,
        top_k=top_k,
        deadline=deadline,
    )
    return [service.index.items[row_idx] for row_idx, _score in ranked_rows[:top_k]]


def run_hybrid(service: OutfitAssistantService, query: str, top_k: int):
    deadline = time.monotonic() + service.search_timeout_seconds if service.ai_enabled else None
    intent = service._heuristic_intent(query)
    ranked, _ai_used, _reasons = service._retrieve_ranked(
        query_text=query,
        intent=intent,
        top_k=top_k,
        deadline=deadline,
    )
    out = []
    for product_id, _score in ranked:
        row_idx = service._id_to_row.get(int(product_id))
        if row_idx is not None:
            out.append(service.index.items[row_idx])
    return out[:top_k]


def quality_score(service: OutfitAssistantService, query: str, items) -> float:
    if not items:
        return 0.0
    intent = service._heuristic_intent(query)
    scores = []
    for item in items:
        boost, _chips = service._business_adjustment(intent, item)
        scores.append(max(0.0, min(1.0, 0.5 + boost)))
    return sum(scores) / len(scores)


def evaluate(service: OutfitAssistantService, queries: list[str], top_k: int) -> dict:
    results = []
    legacy_latency = []
    hybrid_latency = []
    legacy_quality = []
    hybrid_quality = []

    for query in queries:
        start = time.perf_counter()
        legacy_items = run_legacy(service, query, top_k)
        legacy_ms = (time.perf_counter() - start) * 1000.0

        start = time.perf_counter()
        hybrid_items = run_hybrid(service, query, top_k)
        hybrid_ms = (time.perf_counter() - start) * 1000.0

        legacy_q = quality_score(service, query, legacy_items)
        hybrid_q = quality_score(service, query, hybrid_items)

        legacy_latency.append(legacy_ms)
        hybrid_latency.append(hybrid_ms)
        legacy_quality.append(legacy_q)
        hybrid_quality.append(hybrid_q)

        results.append(
            {
                "query": query,
                "legacy_latency_ms": round(legacy_ms, 2),
                "hybrid_latency_ms": round(hybrid_ms, 2),
                "legacy_quality": round(legacy_q, 4),
                "hybrid_quality": round(hybrid_q, 4),
                "legacy_top": [item.name for item in legacy_items[:3]],
                "hybrid_top": [item.name for item in hybrid_items[:3]],
            }
        )

    summary = {
        "queries": len(queries),
        "legacy_latency_ms_avg": round(statistics.mean(legacy_latency), 2),
        "hybrid_latency_ms_avg": round(statistics.mean(hybrid_latency), 2),
        "legacy_quality_avg": round(statistics.mean(legacy_quality), 4),
        "hybrid_quality_avg": round(statistics.mean(hybrid_quality), 4),
        "quality_delta": round(statistics.mean(hybrid_quality) - statistics.mean(legacy_quality), 4),
        "latency_delta_ms": round(statistics.mean(hybrid_latency) - statistics.mean(legacy_latency), 2),
    }

    return {
        "summary": summary,
        "results": results,
    }


def main() -> int:
    load_dotenv(ROOT_DIR / ".env")

    parser = argparse.ArgumentParser(description="Evaluate legacy lexical retrieval vs hybrid Cohere retrieval.")
    parser.add_argument("--top-k", type=int, default=5, help="Number of items evaluated per query.")
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT_DIR / "docs" / "eval_last_run.json",
        help="Where to write JSON evaluation results.",
    )
    parser.add_argument(
        "--query",
        action="append",
        default=[],
        help="Custom query (can be passed multiple times).",
    )
    args = parser.parse_args()

    queries = args.query if args.query else DEFAULT_QUERIES
    service = OutfitAssistantService(root_dir=ROOT_DIR)

    payload = evaluate(service, queries, max(1, args.top_k))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    summary = payload["summary"]
    print("Retrieval Evaluation")
    print(f"queries: {summary['queries']}")
    print(
        f"latency avg (legacy -> hybrid): {summary['legacy_latency_ms_avg']} ms -> "
        f"{summary['hybrid_latency_ms_avg']} ms"
    )
    print(
        f"quality avg (legacy -> hybrid): {summary['legacy_quality_avg']} -> "
        f"{summary['hybrid_quality_avg']}"
    )
    print(f"quality delta: {summary['quality_delta']}")
    print(f"latency delta: {summary['latency_delta_ms']} ms")
    print(f"saved: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
