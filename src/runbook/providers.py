"""Provider adapters (stdlib only). Messages are [{"role": system|user|assistant, "content": str}]."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Protocol

NVIDIA_BASE = "https://integrate.api.nvidia.com/v1"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_NEMOTRON = "nvidia/nemotron-3-super-120b-a12b"
DEFAULT_GEMINI = "gemini-2.5-pro"


class ProviderError(RuntimeError):
    pass


class MissingKey(ProviderError):
    pass


class Provider(Protocol):
    name: str
    model: str

    def complete(self, messages: list[dict[str, str]]) -> str: ...


def _http(url: str, headers: dict[str, str], body: dict[str, Any] | None, timeout: float = 180,
          retries: int = 4) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode()
    delay = 4.0
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")[:500]
            if err.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            raise ProviderError(f"HTTP {err.code} from {url.split('?')[0]}: {detail}") from err
        except (urllib.error.URLError, TimeoutError) as err:
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            raise ProviderError(f"network error calling {url.split('?')[0]}: {err}") from err
    raise ProviderError("unreachable")


def _key(*names: str) -> str:
    for n in names:
        if os.environ.get(n):
            return os.environ[n]
    raise MissingKey(f"set one of {', '.join(names)}")


@dataclass
class NvidiaNemotron:
    model: str = ""
    temperature: float = 0.6
    max_tokens: int = 8192
    name: str = "nemotron"

    def __post_init__(self) -> None:
        self.model = self.model or os.environ.get("NEMOTRON_MODEL", DEFAULT_NEMOTRON)

    def complete(self, messages: list[dict[str, str]]) -> str:
        key = _key("NVIDIA_API_KEY", "NGC_API_KEY")
        out = _http(f"{NVIDIA_BASE}/chat/completions", {"Authorization": f"Bearer {key}"}, {
            "model": self.model, "messages": messages,
            "temperature": self.temperature, "max_tokens": self.max_tokens,
        })
        try:
            return out["choices"][0]["message"].get("content") or ""
        except (KeyError, IndexError) as err:
            raise ProviderError(f"unexpected NVIDIA response: {str(out)[:300]}") from err


@dataclass
class GoogleGemini:
    model: str = ""
    temperature: float = 0.4
    max_tokens: int = 8192
    name: str = "gemini"

    def __post_init__(self) -> None:
        self.model = self.model or os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI)

    def complete(self, messages: list[dict[str, str]]) -> str:
        key = _key("GEMINI_API_KEY", "GOOGLE_API_KEY")
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                    for m in messages if m["role"] != "system"]
        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {"temperature": self.temperature, "maxOutputTokens": self.max_tokens,
                                 "responseMimeType": "application/json"},
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        out = _http(f"{GEMINI_BASE}/models/{self.model}:generateContent", {"x-goog-api-key": key}, body)
        try:
            parts = out["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError) as err:
            raise ProviderError(f"unexpected Gemini response: {str(out)[:300]}") from err


@dataclass
class Scripted:
    """Offline provider that replays fixed replies; used to test the agent loop."""

    replies: list[str]
    name: str = "scripted"
    model: str = "scripted"

    def complete(self, messages: list[dict[str, str]]) -> str:
        turn = sum(1 for m in messages if m["role"] == "assistant")
        return self.replies[min(turn, len(self.replies) - 1)]


def list_models() -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    try:
        key = _key("NVIDIA_API_KEY", "NGC_API_KEY")
        data = _http(f"{NVIDIA_BASE}/models", {"Authorization": f"Bearer {key}"}, None, retries=1)
        found["nvidia"] = sorted(m["id"] for m in data.get("data", []) if "nemotron" in m["id"].lower())
    except ProviderError as err:
        found["nvidia"] = [f"unavailable: {err}"]
    try:
        key = _key("GEMINI_API_KEY", "GOOGLE_API_KEY")
        data = _http(f"{GEMINI_BASE}/models?pageSize=200", {"x-goog-api-key": key}, None, retries=1)
        found["gemini"] = sorted(m["name"].removeprefix("models/") for m in data.get("models", [])
                                 if "generateContent" in m.get("supportedGenerationMethods", []))
    except ProviderError as err:
        found["gemini"] = [f"unavailable: {err}"]
    return found


_THINK = re.compile(r"<think>.*?</think>", re.S)


def extract_tool_call(text: str) -> dict[str, Any] | None:
    """First JSON object in the reply that carries a string "tool" field."""
    text = _THINK.sub("", text)
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            obj, _ = decoder.raw_decode(text[match.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("tool"), str):
            return obj
    return None


PROVIDERS: dict[str, Callable[..., Provider]] = {
    "nemotron": NvidiaNemotron,
    "gemini": GoogleGemini,
}
