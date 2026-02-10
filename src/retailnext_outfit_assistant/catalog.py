from __future__ import annotations

import csv
import json
import shutil
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

SAMPLE_CATALOG_URL = (
    "https://raw.githubusercontent.com/openai/openai-cookbook/main/"
    "examples/data/sample_clothes/sample_styles_with_embeddings.csv"
)


@dataclass(frozen=True)
class CatalogItem:
    id: int
    gender: str
    master_category: str
    sub_category: str
    article_type: str
    base_colour: str
    season: str
    year: int | None
    usage: str
    name: str


@dataclass(frozen=True)
class CatalogIndex:
    items: list[CatalogItem]
    embeddings: np.ndarray  # shape (n, d), float32
    norms: np.ndarray  # shape (n,), float32


def _safe_int(value: str) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except Exception:
        return None


def _parse_embedding(raw: str) -> np.ndarray:
    vec = json.loads(raw)
    return np.asarray(vec, dtype=np.float32)


def _download_file(url: str, dest_path: Path) -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as r, dest_path.open("wb") as f:
        shutil.copyfileobj(r, f)


def load_sample_catalog(data_dir: Path) -> tuple[list[CatalogItem], np.ndarray]:
    csv_path = data_dir / "sample_styles_with_embeddings.csv"
    if not csv_path.exists():
        try:
            _download_file(SAMPLE_CATALOG_URL, csv_path)
        except Exception as e:
            raise FileNotFoundError(
                f"Missing {csv_path}. Download failed ({e}). "
                "Run: python scripts/download_sample_clothes.py (from retailnext_outfit_assistant/) to fetch the full dataset."
            ) from e

    items: list[CatalogItem] = []
    embeddings: list[np.ndarray] = []

    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            items.append(
                CatalogItem(
                    id=int(row["id"]),
                    gender=row["gender"],
                    master_category=row["masterCategory"],
                    sub_category=row["subCategory"],
                    article_type=row["articleType"],
                    base_colour=row["baseColour"],
                    season=row["season"],
                    year=_safe_int(row.get("year", "")),
                    usage=row["usage"],
                    name=row["productDisplayName"],
                )
            )
            embeddings.append(_parse_embedding(row["embeddings"]))

    matrix = np.stack(embeddings, axis=0)
    return items, matrix


def build_or_load_index(data_dir: Path, cache_dir: Path) -> CatalogIndex:
    cache_dir.mkdir(parents=True, exist_ok=True)
    npz_path = cache_dir / "catalog_index.npz"
    meta_path = cache_dir / "catalog_items.jsonl"

    if npz_path.exists() and meta_path.exists():
        arrays = np.load(npz_path)
        embeddings = arrays["embeddings"].astype(np.float32, copy=False)
        norms = arrays["norms"].astype(np.float32, copy=False)
        items: list[CatalogItem] = []
        with meta_path.open("r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    items.append(CatalogItem(**json.loads(line)))
        return CatalogIndex(items=items, embeddings=embeddings, norms=norms)

    items, embeddings = load_sample_catalog(data_dir)
    norms = np.linalg.norm(embeddings, axis=1).astype(np.float32)

    np.savez_compressed(npz_path, embeddings=embeddings.astype(np.float32), norms=norms)
    with meta_path.open("w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item.__dict__) + "\n")

    return CatalogIndex(items=items, embeddings=embeddings.astype(np.float32), norms=norms)


def unique_article_types(items: Iterable[CatalogItem]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item.article_type not in seen:
            seen.add(item.article_type)
            out.append(item.article_type)
    return sorted(out)
