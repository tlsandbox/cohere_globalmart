"""SQLite access layer for catalog items, sessions, recommendations, cart, and feedback."""

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

                CREATE TABLE IF NOT EXISTS shopper_profiles (
                    shopper_name TEXT PRIMARY KEY,
                    membership_tier TEXT NOT NULL,
                    preferred_gender TEXT,
                    favorite_color TEXT,
                    favorite_article_type TEXT,
                    click_events INTEGER NOT NULL DEFAULT 0,
                    cart_add_events INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS cart_items (
                    shopper_name TEXT NOT NULL,
                    product_id INTEGER NOT NULL,
                    quantity INTEGER NOT NULL,
                    added_at TEXT NOT NULL,
                    PRIMARY KEY (shopper_name, product_id),
                    FOREIGN KEY (product_id) REFERENCES catalog_products(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_cart_items_shopper ON cart_items(shopper_name);

                CREATE TABLE IF NOT EXISTS shopper_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    shopper_name TEXT NOT NULL,
                    session_id TEXT,
                    product_id INTEGER,
                    event_type TEXT NOT NULL,
                    event_value TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (product_id) REFERENCES catalog_products(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_shopper_events_name ON shopper_events(shopper_name);
                CREATE INDEX IF NOT EXISTS idx_shopper_events_type ON shopper_events(event_type);
                """
            )

            self._ensure_column(
                conn,
                "shopper_profiles",
                "preferred_gender",
                "TEXT DEFAULT 'Unspecified'",
            )
            self._ensure_column(
                conn,
                "shopper_profiles",
                "favorite_color",
                "TEXT DEFAULT 'Unspecified'",
            )
            self._ensure_column(
                conn,
                "shopper_profiles",
                "favorite_article_type",
                "TEXT DEFAULT 'Unspecified'",
            )
            self._ensure_column(
                conn,
                "shopper_profiles",
                "click_events",
                "INTEGER NOT NULL DEFAULT 0",
            )
            self._ensure_column(
                conn,
                "shopper_profiles",
                "cart_add_events",
                "INTEGER NOT NULL DEFAULT 0",
            )

    @staticmethod
    def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
        rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        return {str(row[1]) for row in rows}

    def _ensure_column(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        column_name: str,
        declaration: str,
    ) -> None:
        existing = self._table_columns(conn, table_name)
        if column_name in existing:
            return
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {declaration}")

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

    def ensure_shopper_profile(self, shopper_name: str) -> None:
        safe_name = shopper_name.strip() or "GlobalMart Fashion Shopper"
        with self._connect() as conn:
            columns = self._table_columns(conn, "shopper_profiles")
            values: dict[str, Any] = {
                "shopper_name": safe_name,
                "membership_tier": "GlobalMart Fashion Plus",
                "updated_at": _utc_now(),
            }
            if "preferred_gender" in columns:
                values["preferred_gender"] = "Unspecified"
            if "favorite_color" in columns:
                values["favorite_color"] = "Unspecified"
            if "favorite_article_type" in columns:
                values["favorite_article_type"] = "Unspecified"
            if "click_events" in columns:
                values["click_events"] = 0
            if "cart_add_events" in columns:
                values["cart_add_events"] = 0

            # Backward-compatible defaults for older schema variants.
            if "style_preferences" in columns:
                values["style_preferences"] = "[]"
            if "color_preferences" in columns:
                values["color_preferences"] = "[]"
            if "usage_preferences" in columns:
                values["usage_preferences"] = "[]"

            column_sql = ", ".join(values.keys())
            placeholder_sql = ", ".join(["?"] * len(values))
            conn.execute(
                f"""
                INSERT INTO shopper_profiles ({column_sql})
                VALUES ({placeholder_sql})
                ON CONFLICT(shopper_name) DO NOTHING
                """,
                tuple(values.values()),
            )

    def get_profile(self, shopper_name: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT shopper_name,
                       membership_tier,
                       preferred_gender,
                       favorite_color,
                       favorite_article_type,
                       click_events,
                       cart_add_events,
                       updated_at
                FROM shopper_profiles
                WHERE shopper_name = ?
                """,
                (shopper_name,),
            ).fetchone()
        return dict(row) if row else None

    def update_profile_preferences(
        self,
        *,
        shopper_name: str,
        preferred_gender: str | None = None,
        favorite_color: str | None = None,
        favorite_article_type: str | None = None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE shopper_profiles
                SET preferred_gender = COALESCE(?, preferred_gender),
                    favorite_color = COALESCE(?, favorite_color),
                    favorite_article_type = COALESCE(?, favorite_article_type),
                    updated_at = ?
                WHERE shopper_name = ?
                """,
                (preferred_gender, favorite_color, favorite_article_type, _utc_now(), shopper_name),
            )

    def increment_profile_event_counter(self, *, shopper_name: str, event_type: str, amount: int = 1) -> None:
        safe_amount = max(1, int(amount))
        with self._connect() as conn:
            if event_type == "cart_add":
                conn.execute(
                    """
                    UPDATE shopper_profiles
                    SET cart_add_events = cart_add_events + ?,
                        updated_at = ?
                    WHERE shopper_name = ?
                    """,
                    (safe_amount, _utc_now(), shopper_name),
                )
                return
            if event_type == "click":
                conn.execute(
                    """
                    UPDATE shopper_profiles
                    SET click_events = click_events + ?,
                        updated_at = ?
                    WHERE shopper_name = ?
                    """,
                    (safe_amount, _utc_now(), shopper_name),
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

    def add_cart_item(self, *, shopper_name: str, product_id: int, quantity: int) -> None:
        safe_qty = max(1, int(quantity))
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO cart_items (shopper_name, product_id, quantity, added_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(shopper_name, product_id) DO UPDATE SET
                    quantity = quantity + excluded.quantity,
                    added_at = excluded.added_at
                """,
                (shopper_name, product_id, safe_qty, _utc_now()),
            )

    def remove_cart_item(self, *, shopper_name: str, product_id: int) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                DELETE FROM cart_items
                WHERE shopper_name = ? AND product_id = ?
                """,
                (shopper_name, product_id),
            )

    def get_cart_items(self, shopper_name: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT ci.shopper_name,
                       ci.product_id,
                       ci.quantity,
                       ci.added_at,
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
                       cp.image_path
                FROM cart_items ci
                JOIN catalog_products cp ON cp.id = ci.product_id
                WHERE ci.shopper_name = ?
                ORDER BY ci.added_at DESC
                """,
                (shopper_name,),
            ).fetchall()
        return [dict(row) for row in rows]

    def record_feedback(
        self,
        *,
        shopper_name: str,
        event_type: str,
        session_id: str | None,
        product_id: int | None,
        event_value: str | None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO shopper_events (
                    shopper_name, session_id, product_id, event_type, event_value, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (shopper_name, session_id, product_id, event_type, event_value, _utc_now()),
            )

    def list_recent_feedback(self, shopper_name: str, *, limit: int = 20) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 100))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT shopper_name, session_id, product_id, event_type, event_value, created_at
                FROM shopper_events
                WHERE shopper_name = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (shopper_name, safe_limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_top_attribute_for_shopper(self, *, shopper_name: str, attribute: str) -> str | None:
        if attribute not in {"gender", "base_colour", "article_type"}:
            return None
        with self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT cp.{attribute} AS value, COUNT(*) AS score
                FROM shopper_events se
                JOIN catalog_products cp ON cp.id = se.product_id
                WHERE se.shopper_name = ?
                  AND se.event_type IN ('click', 'cart_add')
                  AND cp.{attribute} IS NOT NULL
                  AND trim(cp.{attribute}) != ''
                GROUP BY cp.{attribute}
                ORDER BY score DESC
                LIMIT 1
                """,
                (shopper_name,),
            ).fetchone()
        if not row:
            return None
        value = str(row["value"]).strip()
        return value or None

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
                  (SELECT COUNT(*) FROM match_checks) AS match_count,
                  (SELECT COUNT(*) FROM shopper_profiles) AS profile_count,
                  (SELECT COUNT(*) FROM cart_items) AS cart_line_count,
                  (SELECT COUNT(*) FROM shopper_events) AS event_count
                """
            ).fetchone()
        return (
            dict(counts)
            if counts
            else {
                "product_count": 0,
                "session_count": 0,
                "match_count": 0,
                "profile_count": 0,
                "cart_line_count": 0,
                "event_count": 0,
            }
        )
