import json
import os
from typing import Optional

from groq import AsyncGroq

# llama-3.3-70b-versatile (the original plan for this project) was
# deprecated by Groq on 2026-06-17, shutdown 2026-08-16 -- two days
# before this project's submission deadline. openai/gpt-oss-120b is
# Groq's own recommended replacement for that exact model and is what
# Cortex actually calls.
GROQ_MODEL = "openai/gpt-oss-120b"

_client: Optional[AsyncGroq] = None


def _get_client() -> AsyncGroq:
    global _client
    if _client is None:
        api_key = os.environ["GROQ_API_KEY"]
        _client = AsyncGroq(api_key=api_key)
    return _client


async def _chat(system: str, user: str, *, json_mode: bool = False, max_tokens: int = 500) -> str:
    client = _get_client()
    kwargs = {}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    last_err = None
    for attempt in range(2):  # one retry -- Section 5 item 7 saw a transient MCP error, LLM APIs have the same class of hiccup
        try:
            completion = await client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.2,
                max_tokens=max_tokens,
                **kwargs,
            )
            return completion.choices[0].message.content
        except Exception as e:  # noqa: BLE001 -- deliberately broad: one retry, then surface to the caller
            last_err = e
    raise RuntimeError(f"Groq call failed after 2 attempts: {last_err}") from last_err


def _format_runbooks(matched_runbooks: list) -> str:
    if not matched_runbooks:
        return "None found."
    return "\n".join(
        f"- {rb.get('title', 'untitled')}: {rb.get('content', '')[:800]}"
        for rb in matched_runbooks
    )


def _format_postmortems(matched_postmortems: list) -> str:
    if not matched_postmortems:
        return "None found."
    return "\n".join(
        f"- {pm.get('summary', 'untitled')} "
        f"(root cause: {pm.get('root_cause', 'unknown')}, "
        f"remediation taken: {pm.get('remediation_taken', 'n/a')})"
        for pm in matched_postmortems
    )


async def generate_remediation(
    incident: dict,
    matched_runbooks: list,
    matched_postmortems: list,
    seen_before: bool,
    prior_incident_ids: list,
) -> str:
    system = (
        "You are the remediation agent in an SRE incident-response swarm. "
        "Given a live incident and any matching runbooks or past postmortems, "
        "propose ONE specific, actionable remediation step an on-call engineer "
        "or automation could execute right now. Be concrete and technical. "
        "Respond in 2-4 sentences, no preamble."
    )

    seen_before_note = (
        f"This alert fingerprint has been seen before, in incident(s): {', '.join(prior_incident_ids)}."
        if seen_before else
        "This alert fingerprint has not been seen before."
    )

    user = f"""Incident:
- Title: {incident.get('title')}
- Service: {incident.get('service')}
- Severity: {incident.get('severity')}

{seen_before_note}

Matched runbooks (semantic search):
{_format_runbooks(matched_runbooks)}

Matched past postmortems (semantic search):
{_format_postmortems(matched_postmortems)}

Propose the remediation step."""

    result = await _chat(system, user, max_tokens=450)
    return result.strip()


async def generate_postmortem(incident: dict, events: list) -> dict:
    system = (
        "You are the postmortem-writer agent in an SRE incident-response swarm. "
        "Given an incident and its full event timeline, synthesize a postmortem. "
        'Respond ONLY with a JSON object: {"root_cause": "...", "summary": "..."}. '
        "root_cause should be 1-2 sentences naming the underlying cause. "
        "summary should be 3-5 sentences describing what happened, what was done, "
        "and the outcome, suitable for another agent to later find via semantic search."
    )

    timeline = "\n".join(
        f"- [{e.get('created_at', '?')}] {e.get('event_type', '?')}: {e.get('payload', '')}"
        for e in events
    )

    user = f"""Incident:
- Title: {incident.get('title')}
- Service: {incident.get('service')}
- Severity: {incident.get('severity')}

Event timeline:
{timeline}

Write the postmortem JSON."""

    raw = await _chat(system, user, json_mode=True, max_tokens=500)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # gpt-oss-120b's JSON mode is generally reliable but not guaranteed --
        # fall back rather than crash the graph on a malformed response.
        parsed = {"root_cause": "unknown (LLM returned non-JSON)", "summary": raw.strip()}

    return {
        "root_cause": parsed.get("root_cause", "").strip(),
        "summary": parsed.get("summary", "").strip(),
    }
