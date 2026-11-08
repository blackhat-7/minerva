"""config.toml loading. Path from MINERVA_CONFIG (default <repo>/config.toml); data dir from MINERVA_DATA."""

import os
import re
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
    voice: str = ""  # tts only: the default voice
    voices: dict[str, str] = {}  # tts only: voice -> label, offered in Settings; must include `voice`
    api_key_env: str = ""


class Profile(BaseModel):
    """One learner with their own lessons and review cards."""

    name: str
    about: str = ""  # who is learning: background, own hardware and models
    providers: list[str] = []  # the providers this learner may use; empty = all
    login: str = ""  # the auth proxy username, sent as Remote-User; empty = only reachable without the proxy


class Search(BaseModel):
    """Web search before writing a lesson. Default: Exa's free hosted endpoint (no key; queries go to Exa)."""

    enabled: bool = True
    searxng_url: str = ""  # your own SearXNG instead (JSON format enabled in its settings.yml)


class Config(BaseModel):
    providers: list[Provider]
    roles: Roles
    profiles: dict[str, Profile]  # id -> profile; the first one owns lessons made before profiles existed
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
        if self.tts and self.tts.voices and self.tts.voice not in self.tts.voices:
            raise ValueError(f"tts.voices must include the default voice {self.tts.voice!r}")
        if not self.profiles:
            raise ValueError("add at least one [profiles.<id>] section (it replaces [learner])")
        logins = [p.login for p in self.profiles.values() if p.login]
        if len(logins) != len(set(logins)):
            raise ValueError("profiles.<id>.login must be unique")
        for pid, profile in self.profiles.items():
            if not re.fullmatch(r"[a-z0-9_-]+", pid):
                raise ValueError(f"profile id {pid!r}: use lowercase letters, digits, - and _")
            unknown = set(profile.providers) - names
            if unknown:
                raise ValueError(f"profiles.{pid}.providers names unknown providers: {sorted(unknown)}")
            profile.providers = profile.providers or [p.name for p in self.providers]
            for role, listed in self.roles:
                if not set(listed) & set(profile.providers):
                    raise ValueError(f"profiles.{pid} may use none of the providers in roles.{role}")
        return self

    def roles_for(self, profile: Profile) -> dict[str, list[str]]:
        """The role lists, keeping only the providers the profile may use."""
        return {role: [n for n in listed if n in profile.providers] for role, listed in self.roles}

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
