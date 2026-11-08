"""config.toml loading. Path from MINERVA_CONFIG (default <repo>/config.toml); data dir from MINERVA_DATA."""

import os
import tomllib
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, model_validator

REPO = Path(__file__).resolve().parents[3]


class Provider(BaseModel):
    name: str
    kind: Literal["openai", "claude_code"]
    model: str
    html: bool = False  # may write freeform HTML simulations
    # openai only
    base_url: str = ""
    api_key_env: str = ""
    structured: bool = True  # send response_format json_schema
    extra_body: dict = {}


class Roles(BaseModel):
    lesson: list[str]
    tutor: list[str]


class Speech(BaseModel):
    """An OpenAI-compatible audio endpoint (TTS or STT)."""

    base_url: str
    model: str
    voice: str = ""  # tts only
    api_key_env: str = ""


class Learner(BaseModel):
    about: str = ""  # who is learning: background, own hardware and models


class Search(BaseModel):
    """Web search before writing a lesson. Default: Exa's free hosted endpoint (no key; queries go to Exa)."""

    enabled: bool = True
    searxng_url: str = ""  # your own SearXNG instead (JSON format enabled in its settings.yml)


class Config(BaseModel):
    providers: list[Provider]
    roles: Roles
    learner: Learner = Learner()
    search: Search = Search()
    tts: Speech | None = None
    stt: Speech | None = None

    @model_validator(mode="after")
    def _check_roles(self) -> "Config":
        names = {p.name for p in self.providers}
        for role, listed in self.roles:
            unknown = set(listed) - names
            if unknown:
                raise ValueError(f"roles.{role} names unknown providers: {sorted(unknown)}")
        for p in self.providers:
            if p.kind == "openai" and not p.base_url:
                raise ValueError(f"provider {p.name!r}: openai providers need base_url")
        return self

    def provider(self, name: str) -> Provider:
        for p in self.providers:
            if p.name == name:
                return p
        raise KeyError(name)


def config_path() -> Path:
    return Path(os.environ.get("MINERVA_CONFIG", REPO / "config.toml"))


def load_config() -> Config:
    path = config_path()
    if not path.exists():
        raise SystemExit(f"{path} not found. Copy config.example.toml to config.toml and edit it.")
    with path.open("rb") as f:
        return Config.model_validate(tomllib.load(f))


def data_dir() -> Path:
    return Path(os.environ.get("MINERVA_DATA", REPO / "data"))
