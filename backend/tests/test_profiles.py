import json
import sqlite3

import pytest
from conftest import ROOFLINE
from fastapi.testclient import TestClient

from test_api import diagnostic_json, ready_lesson

from minerva import widgets
from minerva.app import create_app
from minerva.config import Config
from minerva.store import Store

ME, FRIEND = {"X-Profile": "me"}, {"X-Profile": "friend"}
PROVIDERS = [
    {"name": "a", "kind": "openai", "base_url": "http://127.0.0.1:9/v1", "model": "m"},
    {"name": "b", "kind": "openai", "base_url": "http://127.0.0.1:9/v1", "model": "m"},
]
ROLES = {"lesson": ["a", "b"], "tutor": ["a", "b"]}


def make_config(profiles: dict, roles: dict = ROLES) -> Config:
    return Config.model_validate({"providers": PROVIDERS, "roles": roles, "profiles": profiles})


def make_client(config: Config, tmp_path, monkeypatch) -> TestClient:
    catalog = tmp_path / "widgets"
    catalog.mkdir(parents=True)
    (catalog / "roofline.json").write_text(json.dumps(ROOFLINE))
    monkeypatch.setattr(widgets, "CATALOG_DIR", catalog)
    return TestClient(create_app(config, tmp_path / "data"))


@pytest.fixture
def two(fake, tmp_path, monkeypatch):
    config = make_config({"me": {"name": "Me"}, "friend": {"name": "Friend", "providers": ["b"]}})
    with make_client(config, tmp_path / "two", monkeypatch) as c:
        yield c


def test_profiles_are_isolated(two, fake):
    assert two.get("/api/profiles").json() == [{"id": "me", "name": "Me"}, {"id": "friend", "name": "Friend"}]
    two.headers.update(ME)
    lesson_id = ready_lesson(two, fake)
    two.post(f"/api/lessons/{lesson_id}/complete")
    card_id = two.get("/api/cards/due").json()[0]["id"]

    two.headers.update(FRIEND)
    assert two.get("/api/lessons").json() == [] and two.get("/api/cards/due").json() == []
    assert two.get(f"/api/lessons/{lesson_id}").status_code == 404
    assert two.delete(f"/api/lessons/{lesson_id}").status_code == 404
    body = {"lesson_id": lesson_id, "messages": [{"role": "user", "content": "hi"}]}
    assert two.post("/api/tutor", json=body).status_code == 404
    assert two.post(f"/api/cards/{card_id}/review", json={"rating": 3}).status_code == 404

    two.headers.update(ME)
    assert len(two.get("/api/lessons").json()) == 1 and len(two.get("/api/cards/due").json()) == 2


def test_profile_header_rules(two, client):
    assert two.get("/api/lessons").status_code == 400  # several profiles, no header
    assert two.get("/api/lessons", headers={"X-Profile": "ghost"}).status_code == 400
    assert two.get("/api/lessons", headers=ME).status_code == 200
    assert client.get("/api/lessons").status_code == 200  # one profile: header optional
    assert client.get("/api/lessons", headers={"X-Profile": "ghost"}).status_code == 400


@pytest.fixture
def proxied(fake, tmp_path, monkeypatch):
    config = make_config({"me": {"name": "Me", "login": "alice"}, "friend": {"name": "Friend", "login": "bob"}})
    with make_client(config, tmp_path / "proxied", monkeypatch) as c:
        yield c


def test_remote_user_locks_to_its_profile(proxied):
    alice, bob = {"Remote-User": "alice"}, {"Remote-User": "bob"}
    assert proxied.get("/api/profiles", headers=alice).json() == [{"id": "me", "name": "Me"}]
    assert proxied.get("/api/profiles").json() == [{"id": "me", "name": "Me"}, {"id": "friend", "name": "Friend"}]
    assert proxied.get("/api/lessons", headers=alice).status_code == 200  # no X-Profile: the only candidate
    assert proxied.get("/api/lessons", headers={**alice, **ME}).status_code == 200
    assert proxied.get("/api/lessons", headers={**alice, **FRIEND}).status_code == 403
    assert proxied.get("/api/lessons", headers={**bob, **ME}).status_code == 403
    assert proxied.get("/api/lessons", headers={"Remote-User": "carol"}).status_code == 403
    assert proxied.get("/api/profiles", headers={"Remote-User": "carol"}).status_code == 403
    assert proxied.get("/api/lessons").status_code == 400  # no header: unchanged


def test_profile_only_uses_its_providers(two, fake):
    two.headers.update(FRIEND)
    fake.replies.append(diagnostic_json())
    assert two.post("/api/lessons", json={"topic": "T"}).status_code == 200
    assert {c["provider"] for c in fake.calls} == {"b"}  # "a" comes first in the role, but is not allowed
    assert two.post("/api/lessons", json={"topic": "T", "provider": "a"}).status_code == 403
    status = two.get("/api/status").json()
    assert [p["name"] for p in status["providers"]] == ["b"] and status["roles"] == {"lesson": ["b"], "tutor": ["b"]}
    assert [p["name"] for p in two.get("/api/settings").json()["providers"]] == ["b"]


def test_store_migrates_a_pre_profile_database(tmp_path):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as db:
        db.executescript("""
            CREATE TABLE lessons (id TEXT PRIMARY KEY, topic TEXT NOT NULL, created_at TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
                diagnostic TEXT, lesson TEXT, progress TEXT NOT NULL DEFAULT '{}',
                cards_added INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE cards (id TEXT PRIMARY KEY, lesson_id TEXT, topic TEXT NOT NULL, front TEXT NOT NULL,
                back TEXT NOT NULL, fsrs TEXT NOT NULL, due REAL NOT NULL, created_at TEXT NOT NULL);
            CREATE INDEX cards_due ON cards (due);
            INSERT INTO lessons (id, topic, created_at, status) VALUES ('l1', 'T', 'now', 'ready');
            INSERT INTO cards VALUES ('c1', 'l1', 'T', 'f', 'b', '{}', 0, 'now');
        """)
    store = Store(path, owner="me")
    assert [r["id"] for r in store.list_lessons("me")] == ["l1"] and store.list_lessons("friend") == []
    assert [c["id"] for c in store.due_cards("me", 10)] == ["c1"] and store.due_count("friend") == 0
    Store(path, owner="friend")  # reopening keeps the owner
    assert store.list_lessons("friend") == []


@pytest.mark.parametrize("profiles, roles, message", [
    ({"Bad Id": {"name": "X"}}, ROLES, "profile id"),
    ({"me": {"name": "Me", "login": "x"}, "friend": {"name": "F", "login": "x"}}, ROLES, "login must be unique"),
    ({"me": {"name": "Me", "providers": ["ghost"]}}, ROLES, "unknown providers"),
    ({"me": {"name": "Me", "providers": ["b"]}}, {"lesson": ["a", "b"], "tutor": ["a"]}, "none of the providers"),
])
def test_profile_config_errors(profiles, roles, message):
    with pytest.raises(ValueError, match=message):
        make_config(profiles, roles)
