from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from retailnext_outfit_assistant.catalog import CatalogItem


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RetailNextDB:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS catalog_products (
                    id INTEGER PRIMARY KEY,
                    gender TEXT NOT NULL,
                    master_category TEXT NOT NULL,
                    sub_category TEXT NOT NULL,
                    article_type TEXT NOT NULL,
                    base_colour TEXT NOT NULL,
                    season TEXT,
                    year INTEGER,
                    usage TEXT,
                    name TEXT NOT NULL,
                    image_path TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_catalog_gender ON catalog_products(gender);
                CREATE INDEX IF NOT EXISTS idx_catalog_article_type ON catalog_products(article_type);
                CREATE INDEX IF NOT EXISTS idx_catalog_usage ON catalog_products(usage);

                CREATE TABLE IF NOT EXISTS recommendation_sessions (
                    session_id TEXT PRIMARY KEY,
                    shopper_name TEXT NOT NULL,
                    source TEXT NOT NULL,
                    query_text TEXT,
                    image_summary TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS recommendation_items (
                    session_id TEXT NOT NULL,
                    product_id INTEGER NOT NULL,
                    rank_position INTEGER NOT NULL,
                    score REAL NOT NULL,
                    PRIMARY KEY (session_id, rank_position),
                    FOREIGN KEY (session_id) REFERENCES recommendation_sessions(session_id) ON DELETE CASCADE,
                    FOREIGN KEY (product_id) REFERENCES catalog_products(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_recommendation_items_product
                    ON recommendation_items(product_id);

                CREATE TABLE IF NOT EXISTS match_checks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    product_id INTEGER NOT NULL,
                    verdict TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    confidence REAL,
                    created_at TEXT NOT NULL,
                    UNIQUE(session_id, product_id),
                    FOREIGN KEY (session_id) REFERENCES recommendation_sessions(session_id) ON DELETE CASCADE,
                    FOREIGN KEY (product_id) REFERENCES catalog_products(id) ON DELETE CASCADE
                );
                """
            )

    def upsert_catalog(self, items: list[CatalogItem], image_dir: Path) -> None:
        timestamp = _utc_now()
        payload: list[tuple[Any, ...]] = []
        for item in items:
            local_image = image_dir / f"{item.id}.jpg"
            payload.append(
                (
                    item.id,
                    item.gender,
                    item.master_category,
                    item.sub_category,
                    item.article_type,
                    item.base_colour,
                    item.season,
                    item.year,
                    item.usage,
                    item.name,
                    str(local_image) if local_image.exists() else None,
                    timestamp,
                )
            )

        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO catalog_products (
                    id, gender, master_category, sub_category, article_type,
                    base_colour, season, year, usage, name, image_path, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    gender=excluded.gender,
                    master_category=excluded.master_category,
                    sub_category=excluded.sub_category,
                    article_type=excluded.article_type,
                    base_colour=excluded.base_colour,
                    season=excluded.season,
                    year=excluded.year,
                    usage=excluded.usage,
                    name=excluded.name,
                    image_path=excluded.image_path,
                    updated_at=excluded.updated_at
                """,
                payload,
            )

    def list_random_products(self, limit: int, gender: str | None = None) -> list[dict[str, Any]]:
        with self._connect() as conn:
            if gender:
                rows = conn.execute(
                    """
                    SELECT id, gender, master_category, sub_category, article_type,
                           base_colour, season, year, usage, name, image_path
                    FROM catalog_products
                    WHERE lower(gender) = lower(?)
                    ORDER BY RANDOM()
                    LIMIT ?
                    """,
                    (gender, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, gender, master_category, sub_category, article_type,
                           base_colour, season, year, usage, name, image_path
                    FROM catalog_products
                    ORDER BY RANDOM()
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
        return [dict(row) for row in rows]

    def create_session(
        self,
        *,
        shopper_name: str,
        source: str,
        query_text: str | None,
        image_summary: str | None,
    ) -> str:
        session_id = uuid.uuid4().hex
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO recommendation_sessions
                    (session_id, shopper_name, source, query_text, image_summary, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (session_id, shopper_name, source, query_text, image_summary, _utc_now()),
            )
        return session_id

    def store_recommendations(self, session_id: str, ranked: list[tuple[int, float]]) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM recommendation_items WHERE session_id = ?", (session_id,))
            conn.executemany(
                """
                INSERT INTO recommendation_items (session_id, product_id, rank_position, score)
                VALUES (?, ?, ?, ?)
                """,
                [(session_id, pid, rank + 1, score) for rank, (pid, score) in enumerate(ranked)],
            )

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT session_id, shopper_name, source, query_text, image_summary, created_at
                FROM recommendation_sessions
                WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()
        return dict(row) if row else None

    def get_recommendations(self, session_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT ri.rank_position,
                       ri.score,
                       cp.id,
                       cp.gender,
                       cp.master_category,
                       cp.sub_category,
                       cp.article_type,
                       cp.base_colour,
                       cp.season,
                       cp.year,
                       cp.usage,
                       cp.name,
                       cp.image_path,
                       mc.verdict AS match_verdict,
                       mc.rationale AS match_rationale,
                       mc.confidence AS match_confidence
                FROM recommendation_items ri
                JOIN catalog_products cp ON cp.id = ri.product_id
                LEFT JOIN match_checks mc
                  ON mc.session_id = ri.session_id AND mc.product_id = ri.product_id
                WHERE ri.session_id = ?
                ORDER BY ri.rank_position ASC
                """,
                (session_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_product(self, product_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, gender, master_category, sub_category, article_type,
                       base_colour, season, year, usage, name, image_path
                FROM catalog_products
                WHERE id = ?
                """,
                (product_id,),
            ).fetchone()
        return dict(row) if row else None

    def store_match_check(
        self,
        *,
        session_id: str,
        product_id: int,
        verdict: str,
        rationale: str,
        confidence: float | None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO match_checks (session_id, product_id, verdict, rationale, confidence, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, product_id) DO UPDATE SET
                    verdict=excluded.verdict,
                    rationale=excluded.rationale,
                    confidence=excluded.confidence,
                    created_at=excluded.created_at
                """,
                (session_id, product_id, verdict, rationale, confidence, _utc_now()),
            )

    def stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            counts = conn.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM catalog_products) AS product_count,
                  (SELECT COUNT(*) FROM recommendation_sessions) AS session_count,
                  (SELECT COUNT(*) FROM match_checks) AS match_count
                """
            ).fetchone()
        return dict(counts) if counts else {"product_count": 0, "session_count": 0, "match_count": 0}
