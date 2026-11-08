"""SQLite storage: lessons, review cards (FSRS state as JSON) and review logs. Lessons and cards belong to a profile."""

import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from itertools import zip_longest
from pathlib import Path

from fsrs import Card as FsrsCard
from fsrs import Rating, Scheduler

SCHEMA = """
CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    topic TEXT NOT NULL,
    created_at TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    error TEXT NOT NULL DEFAULT '',
    learner TEXT NOT NULL DEFAULT '',  -- what the diagnostic showed the learner knows
    diagnostic TEXT,              -- JSON Diagnostic
    lesson TEXT,                  -- JSON Lesson
    progress TEXT NOT NULL DEFAULT '{}',
    cards_added INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    lesson_id TEXT,
    topic TEXT NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    fsrs TEXT NOT NULL,           -- fsrs.Card.to_json()
    due REAL NOT NULL,            -- unix seconds, copied from fsrs for querying
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    card_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    reviewed_at TEXT NOT NULL,
    log TEXT NOT NULL             -- fsrs.ReviewLog.to_json()
);
"""

LESSON_JSON_COLUMNS = ("diagnostic", "lesson", "progress")


def now() -> str:
    return datetime.now(UTC).isoformat()


class Store:
    def __init__(self, path: Path, owner: str):
        """`owner`: the profile that gets lessons and cards made before profiles existed."""
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.scheduler = Scheduler()
        with self._db() as db:
            db.executescript(SCHEMA)
            for table in ("lessons", "cards"):
                columns = {r["name"] for r in db.execute(f"PRAGMA table_info({table})")}
                if "profile" not in columns:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN profile TEXT NOT NULL DEFAULT ''")
                    db.execute(f"UPDATE {table} SET profile = ?", (owner,))
            if "learner" not in {r["name"] for r in db.execute("PRAGMA table_info(lessons)")}:
                db.execute("ALTER TABLE lessons ADD COLUMN learner TEXT NOT NULL DEFAULT ''")
            db.execute("DROP INDEX IF EXISTS cards_due")
            db.execute("CREATE INDEX IF NOT EXISTS cards_profile_due ON cards (profile, due)")

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        """A connection per operation, committed and closed at the end. Cheap for SQLite."""
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    # --- lessons ---

    def create_lesson(self, profile: str, topic: str, provider: str, diagnostic: dict) -> dict:
        lesson_id = uuid.uuid4().hex[:12]
        with self._db() as db:
            db.execute(
                "INSERT INTO lessons (id, profile, topic, created_at, provider, status, diagnostic)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (lesson_id, profile, topic, now(), provider, "diagnostic", json.dumps(diagnostic)),
            )
        return self.get_lesson(profile, lesson_id)

    def get_lesson(self, profile: str, lesson_id: str) -> dict | None:
        with self._db() as db:
            row = db.execute(
                "SELECT id, topic, created_at, provider, status, error, learner, diagnostic, lesson, progress"
                " FROM lessons WHERE id = ? AND profile = ?",
                (lesson_id, profile),
            ).fetchone()
        if row is None:
            return None
        record = dict(row)
        for col in LESSON_JSON_COLUMNS:
            record[col] = json.loads(record[col]) if record[col] is not None else None
        return record

    def list_lessons(self, profile: str) -> list[dict]:
        with self._db() as db:
            rows = db.execute(
                "SELECT id, topic, coalesce(json_extract(lesson, '$.title'), '') AS title, status, created_at"
                " FROM lessons WHERE profile = ? ORDER BY created_at DESC",
                (profile,),
            ).fetchall()
        return [dict(r) for r in rows]

    def update_lesson(self, lesson_id: str, **fields) -> None:
        for col in LESSON_JSON_COLUMNS:
            if col in fields:
                fields[col] = json.dumps(fields[col])
        assignments = ", ".join(f"{k} = ?" for k in fields)  # keys come from our code, never from requests
        with self._db() as db:
            db.execute(f"UPDATE lessons SET {assignments} WHERE id = ?", (*fields.values(), lesson_id))

    def delete_lesson(self, lesson_id: str) -> None:
        with self._db() as db:
            db.execute("DELETE FROM reviews WHERE card_id IN (SELECT id FROM cards WHERE lesson_id = ?)", (lesson_id,))
            db.execute("DELETE FROM cards WHERE lesson_id = ?", (lesson_id,))
            db.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))

    def fail_interrupted(self) -> None:
        """Generation runs in-process; after a restart nothing is generating anymore."""
        with self._db() as db:
            db.execute("UPDATE lessons SET status = 'failed', error = 'interrupted by a server restart'"
                       " WHERE status = 'generating'")

    def complete_lesson(self, profile: str, lesson_id: str, cards: list[dict], topic: str) -> None:
        """Adds the lesson's cards once. The flag flips in the same transaction as the inserts."""
        with self._db() as db:
            claimed = db.execute(
                "UPDATE lessons SET cards_added = 1 WHERE id = ? AND cards_added = 0", (lesson_id,)
            ).rowcount
            if claimed:
                for c in cards:
                    self._insert_card(db, profile, lesson_id, topic, c["front"], c["back"])

    # --- cards ---

    def add_card(self, profile: str, lesson_id: str | None, topic: str, front: str, back: str) -> str:
        with self._db() as db:
            return self._insert_card(db, profile, lesson_id, topic, front, back)

    def _insert_card(
        self, db: sqlite3.Connection, profile: str, lesson_id: str | None, topic: str, front: str, back: str
    ) -> str:
        card_id = uuid.uuid4().hex[:12]
        card = FsrsCard()
        db.execute(
            "INSERT INTO cards (id, profile, lesson_id, topic, front, back, fsrs, due, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (card_id, profile, lesson_id, topic, front, back, card.to_json(), card.due.timestamp(), now()),
        )
        return card_id

    def due_count(self, profile: str) -> int:
        with self._db() as db:
            return db.execute(
                "SELECT count(*) FROM cards WHERE profile = ? AND due <= ?", (profile, datetime.now(UTC).timestamp())
            ).fetchone()[0]

    def due_cards(self, profile: str, limit: int) -> list[dict]:
        """Due cards, most overdue first within a topic, round-robin across topics (interleaving)."""
        with self._db() as db:
            rows = db.execute(
                "SELECT id, front, back, topic, lesson_id FROM cards WHERE profile = ? AND due <= ? ORDER BY due",
                (profile, datetime.now(UTC).timestamp()),
            ).fetchall()
        by_topic: dict[str, list[dict]] = {}
        for r in rows:
            by_topic.setdefault(r["topic"], []).append(dict(r))
        interleaved = [c for group in zip_longest(*by_topic.values()) for c in group if c is not None]
        return interleaved[:limit]

    def review_card(self, profile: str, card_id: str, rating: int) -> datetime | None:
        with self._db() as db:
            row = db.execute("SELECT fsrs FROM cards WHERE id = ? AND profile = ?", (card_id, profile)).fetchone()
            if row is None:
                return None
            card, log = self.scheduler.review_card(FsrsCard.from_json(row["fsrs"]), Rating(rating))
            db.execute("UPDATE cards SET fsrs = ?, due = ? WHERE id = ?", (card.to_json(), card.due.timestamp(), card_id))
            db.execute(
                "INSERT INTO reviews (card_id, rating, reviewed_at, log) VALUES (?, ?, ?, ?)",
                (card_id, rating, now(), log.to_json()),
            )
        return card.due
