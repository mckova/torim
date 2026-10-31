"""A small, dependency-light agent loop on the Anthropic Messages API.

Both TORIM agents (the customer receptionist and the owner copilot) run here:
the model gets a system prompt and a set of tools, decides which tools to call,
we execute them against the real booking engine, and loop until it answers.

Design notes
- Model: Claude Opus 5.5 (`claude-opus-5-5`) with adaptive thinking. Effort is
  set per agent (thinking cannot be disabled on this model; effort is the knob).
- Server-side refusal fallback is on (`fallbacks="default"`), so a safety
  decline is retried on a fallback model inside the same call.
- History is append-only: we store each assistant `response.content` exactly as
  returned (thinking blocks included) and send it back unchanged, which is what
  preserved thinking requires. Nothing in an earlier turn is ever edited.
- Prompt caching: the system prompt and tool list are stable per business, and
  the volatile current time travels inside the user turn, not the system prompt.
- Tools use `strict: true`, so arguments always match the schema.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger("torim.ai")

MODEL = os.environ.get("TORIM_AI_MODEL", "claude-opus-5-5")
MAX_STEPS = 8
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AIUnavailable(RuntimeError):
    pass


_client = None


def get_client():
    """The Anthropic client, or None when no credentials are configured."""
    global _client
    if _client is not None:
        return _client
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return None
    import anthropic

    _client = anthropic.Anthropic()
    return _client


def set_client(client) -> None:
    """Inject a client (tests use a scripted fake)."""
    global _client
    _client = client


def enabled() -> bool:
    """True when a model is configured."""
    return get_client() is not None


def available() -> bool:
    """True when the assistants can answer at all: a model, or the offline demo mode."""
    from . import demo

    return enabled() or demo.allowed()


@dataclass
class Tool:
    name: str
    description: str
    properties: dict[str, Any]
    required: list[str]
    run: Callable[..., Any]

    def schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "strict": True,
            "input_schema": {
                "type": "object",
                "properties": self.properties,
                "required": self.required,
                "additionalProperties": False,
            },
        }


@dataclass
class TurnResult:
    reply: str
    messages: list[dict]
    actions: list[dict] = field(default_factory=list)
    tool_calls: list[str] = field(default_factory=list)


def _dump(block: Any) -> dict:
    if isinstance(block, dict):
        return block
    if hasattr(block, "model_dump"):
        return block.model_dump(mode="json", exclude_none=True)
    return dict(vars(block))


def run_turn(
    *,
    system: str,
    tools: list[Tool],
    history: list[dict],
    user_text: str,
    effort: str = "medium",
    max_tokens: int = 16000,
) -> TurnResult:
    client = get_client()
    if client is None:
        raise AIUnavailable("ANTHROPIC_API_KEY is not configured")

    by_name = {t.name: t for t in tools}
    messages = list(history) + [{"role": "user", "content": user_text}]
    actions: list[dict] = []
    calls: list[str] = []

    for _ in range(MAX_STEPS):
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            tools=[t.schema() for t in tools],
            messages=messages,
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            cache_control={"type": "ephemeral"},
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
        content = [_dump(b) for b in response.content]
        messages.append({"role": "assistant", "content": content})

        if response.stop_reason == "refusal":
            return TurnResult("Sorry, I can't help with that. Try phrasing it differently, or contact the business.", messages, actions, calls)
        if response.stop_reason == "pause_turn":
            continue
        if response.stop_reason != "tool_use":
            text = "\n".join(b["text"] for b in content if b.get("type") == "text").strip()
            return TurnResult(text, messages, actions, calls)

        results = []
        for block in content:
            if block.get("type") != "tool_use":
                continue
            tool = by_name.get(block["name"])
            calls.append(block["name"])
            try:
                if tool is None:
                    raise ValueError(f"unknown tool {block['name']}")
                out = tool.run(**(block.get("input") or {}))
                if isinstance(out, dict) and "_action" in out:
                    actions.append(out.pop("_action"))
                results.append(
                    {"type": "tool_result", "tool_use_id": block["id"], "content": json.dumps(out, ensure_ascii=False, default=str)}
                )
            except Exception as exc:  # the model sees the error and can recover
                detail = getattr(exc, "detail", None) or str(exc)
                log.info("tool %s failed: %s", block["name"], detail)
                results.append({"type": "tool_result", "tool_use_id": block["id"], "content": f"Error: {detail}", "is_error": True})
        messages.append({"role": "user", "content": results})

    return TurnResult("Sorry, I couldn't finish that request. Try again, or contact the business.", messages, actions, calls)


def structured(*, system: str, user_text: str, schema: dict, effort: str = "medium", max_tokens: int = 8000) -> dict:
    """One-shot call whose answer is guaranteed to match `schema` (structured outputs).

    Used for generation tasks that feed straight into the UI or the database,
    such as the business setup proposal, the morning briefing and personal
    reminders, where free text would have to be parsed.
    """
    client = get_client()
    if client is None:
        raise AIUnavailable("ANTHROPIC_API_KEY is not configured")
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_text}],
        thinking={"type": "adaptive"},
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        cache_control={"type": "ephemeral"},
        betas=[FALLBACK_BETA],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise AIUnavailable("the model declined this request")
    text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), None)
    if text is None:
        raise AIUnavailable("empty AI response")
    return json.loads(text)


def obj(properties: dict, required: list[str] | None = None) -> dict:
    """JSON-schema object helper for structured outputs (all fields required, closed)."""
    return {"type": "object", "properties": properties, "required": required or list(properties), "additionalProperties": False}
