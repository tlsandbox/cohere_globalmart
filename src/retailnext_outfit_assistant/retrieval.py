from __future__ import annotations

import numpy as np


def top_k_cosine(
    query: np.ndarray,
    embeddings: np.ndarray,
    norms: np.ndarray,
    k: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (indices, scores) for top-k cosine similarity."""
    if query.ndim != 1:
        raise ValueError("query must be 1D")
    if embeddings.ndim != 2:
        raise ValueError("embeddings must be 2D")
    if embeddings.shape[0] != norms.shape[0]:
        raise ValueError("norms must match embeddings rows")

    query = query.astype(np.float32, copy=False)
    qn = np.linalg.norm(query).astype(np.float32)
    if qn == 0:
        raise ValueError("zero-norm query embedding")

    scores = (embeddings @ query) / (norms * qn + 1e-8)
    k = min(int(k), scores.shape[0])
    idx = np.argpartition(-scores, k - 1)[:k]
    idx = idx[np.argsort(-scores[idx])]
    return idx, scores[idx]

