import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from openai import OpenAI

if TYPE_CHECKING:
    from config.settings import Settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are an expert code reviewer. Analyze the provided pull request diff and \
return a structured JSON review. Be specific — reference exact file names and \
line context when possible.

You MUST return ONLY valid JSON matching this schema (no markdown fences):
{
  "issues": [
    {"file": "path", "severity": "high|medium|low", "description": "..."}
  ],
  "security_concerns": [
    {"file": "path", "severity": "high|medium|low", "description": "..."}
  ],
  "performance_concerns": [
    {"file": "path", "severity": "high|medium|low", "description": "..."}
  ],
  "code_smells": [
    {"file": "path", "severity": "high|medium|low", "description": "..."}
  ],
  "suggested_improvements": [
    {"file": "path", "description": "..."}
  ],
  "summary": "Brief overall assessment"
}

Focus on: logical bugs, edge cases, missing validations, performance issues, \
security vulnerabilities, code smells, and optimization opportunities.\
"""

# Tunable via env: low-credit OpenRouter accounts cap prompt tokens per
# request (e.g. 8344), which a 60k-char chunk (~14k tokens) blows past with
# a 402. Set LLM_CHUNK_CHARS=24000 to fit under such caps without code edits.
CHUNK_SIZE = int(os.getenv("LLM_CHUNK_CHARS", "60000"))

# OpenRouter's free-tier prompt-token cap isn't fixed — it moves with the
# account's remaining free quota (observed dropping from 8344 to 7035 within
# the same hour). A static CHUNK_SIZE inevitably goes stale, so on a 402 we
# read the live cap straight out of the error and re-split to fit under it,
# rather than asking the user to keep re-guessing a number.
_TOKEN_LIMIT_RE = re.compile(r"limit exceeded:\s*\d+\s*>\s*(\d+)")
_CHARS_PER_TOKEN = 3  # conservative — code/diff text runs closer to 3 than 4
MAX_SPLIT_DEPTH = 6


@dataclass
class LLMReviewResult:
    issues: list[dict] = field(default_factory=list)
    security_concerns: list[dict] = field(default_factory=list)
    performance_concerns: list[dict] = field(default_factory=list)
    code_smells: list[dict] = field(default_factory=list)
    suggested_improvements: list[dict] = field(default_factory=list)
    summary: str = ""

    def to_dict(self) -> dict:
        return {
            "issues": self.issues,
            "security_concerns": self.security_concerns,
            "performance_concerns": self.performance_concerns,
            "code_smells": self.code_smells,
            "suggested_improvements": self.suggested_improvements,
            "summary": self.summary,
        }


class OpenAIReviewer:
    """
    LLM-based PR reviewer.

    Works with any OpenAI-compatible provider:
      - OpenAI        (default)
      - OpenRouter    (LLM_PROVIDER=openrouter)
      - Ollama        (LLM_PROVIDER=ollama)
      - Custom        (LLM_PROVIDER=custom, LLM_BASE_URL=https://...)
    """

    def __init__(self, settings: "Settings | None" = None,
                 api_key: str | None = None,
                 model: str = ""):
        # Accept a Settings object (preferred) or legacy positional args
        if settings is not None:
            resolved_key   = settings.resolved_llm_api_key
            resolved_model = settings.resolved_llm_model
            base_url       = settings.resolved_llm_base_url
            provider       = settings.llm_provider
        else:
            resolved_key   = api_key or os.getenv("OPENAI_API_KEY", "")
            resolved_model = model or os.getenv("OPENAI_MODEL", "gpt-4.1")
            base_url       = None
            provider       = "openai"

        if not resolved_key and provider != "ollama":
            raise ValueError(
                f"No API key set for provider '{provider}'. "
                "Set LLM_API_KEY (or OPENAI_API_KEY) in your .env file."
            )

        # A provider other than "openai" silently falling back to
        # OPENAI_API_KEY almost always means LLM_API_KEY was never set —
        # the request then goes out with a key the real provider's gateway
        # doesn't recognize, which reads as a generic 401 with no hint why.
        if (settings is not None and provider != "openai"
                and not settings.llm_api_key and settings.openai_api_key):
            logger.warning(
                "LLM_PROVIDER=%s but LLM_API_KEY is not set — falling back "
                "to OPENAI_API_KEY, which %s will reject. Set LLM_API_KEY to "
                "a key issued by %s.", provider, provider, provider,
            )

        self.model = resolved_model
        self.provider = provider
        logger.info("LLM provider: %s | model: %s | base_url: %s",
                    provider, self.model, base_url or "(default)")

        client_kwargs: dict = {"api_key": resolved_key or "ollama"}
        if base_url:
            client_kwargs["base_url"] = base_url
        self.client = OpenAI(**client_kwargs)

    def review_diff(self, diff_text: str,
                    pr_title: str = "",
                    pr_description: str = "",
                    extra_context: str = "") -> LLMReviewResult:
        if not diff_text.strip():
            return LLMReviewResult(summary="No diff content to review.")

        chunks = self._chunk_diff(diff_text)
        if len(chunks) == 1:
            return self._review_single(
                chunks[0], pr_title, pr_description,
                extra_context=extra_context,
            )

        # Multiple chunks — review each, then merge
        logger.info("Large diff split into %d chunks", len(chunks))
        partial_results = []
        for i, chunk in enumerate(chunks):
            logger.info("Reviewing chunk %d/%d...", i + 1, len(chunks))
            result = self._review_single(
                chunk, pr_title, pr_description,
                context=f"(Part {i + 1} of {len(chunks)})",
                extra_context=extra_context if i == 0 else "",
            )
            partial_results.append(result)

        return self._merge_results(partial_results)

    def _review_single(self, diff_chunk: str, pr_title: str,
                       pr_description: str,
                       context: str = "",
                       extra_context: str = "",
                       _depth: int = 0) -> LLMReviewResult:
        user_content = self._build_user_prompt(
            diff_chunk, pr_title, pr_description, context, extra_context
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.2,
                max_tokens=4096,
            )
            raw = response.choices[0].message.content.strip()
            return self._parse_response(raw)
        except Exception as exc:
            live_cap = self._extract_token_limit(exc)
            if live_cap and _depth < MAX_SPLIT_DEPTH and len(diff_chunk) > 500:
                # Leave headroom for the system prompt + title/description,
                # which share the same token budget as the diff.
                safe_chars = max(500, live_cap * _CHARS_PER_TOKEN - 1000)
                if safe_chars < len(diff_chunk):
                    pieces = [diff_chunk[i:i + safe_chars]
                             for i in range(0, len(diff_chunk), safe_chars)]
                    logger.info(
                        "Provider prompt cap is now %d tokens — re-splitting "
                        "a %d-char chunk into %d smaller pieces",
                        live_cap, len(diff_chunk), len(pieces),
                    )
                    results = [
                        self._review_single(
                            piece, pr_title, pr_description,
                            context=context,
                            extra_context=extra_context if i == 0 else "",
                            _depth=_depth + 1,
                        )
                        for i, piece in enumerate(pieces)
                    ]
                    return self._merge_results(results)
            logger.exception("OpenAI API call failed")
            return LLMReviewResult(
                summary="LLM analysis failed due to an API error."
            )

    @staticmethod
    def _extract_token_limit(exc: Exception) -> int | None:
        """Pull the provider's current prompt-token cap out of a 402 error
        message like 'Prompt tokens limit exceeded: 14684 > 8344'."""
        m = _TOKEN_LIMIT_RE.search(str(exc))
        return int(m.group(1)) if m else None

    @staticmethod
    def _build_user_prompt(diff: str, title: str, description: str,
                           context: str, extra_context: str = "") -> str:
        parts = []
        if title:
            parts.append(f"PR Title: {title}")
        if description:
            parts.append(f"PR Description: {description[:1000]}")
        if extra_context:
            parts.append(extra_context)
        if context:
            parts.append(context)
        parts.append(f"\n--- DIFF ---\n{diff}")
        return "\n".join(parts)

    @staticmethod
    def _parse_response(raw: str) -> LLMReviewResult:
        # Strip markdown code fences if present
        text = raw.strip()
        if text.startswith("```"):
            first_newline = text.index("\n")
            text = text[first_newline + 1:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = OpenAIReviewer._parse_json_lenient(text)
            if data is None:
                logger.warning("Failed to parse LLM JSON response, "
                               "returning raw as summary")
                return LLMReviewResult(summary=raw[:2000])
            logger.info("Recovered LLM JSON via lenient parse")

        return LLMReviewResult(
            issues=data.get("issues", []),
            security_concerns=data.get("security_concerns", []),
            performance_concerns=data.get("performance_concerns", []),
            code_smells=data.get("code_smells", []),
            suggested_improvements=data.get("suggested_improvements", []),
            summary=data.get("summary", ""),
        )

    @staticmethod
    def _parse_json_lenient(text: str) -> dict | None:
        """Recover JSON from a response with prose around it or a tail cut
        off by max_tokens. Trims to the last complete object/array and closes
        any brackets left open — a truncated final finding is dropped, the
        rest survive."""
        start = text.find("{")
        if start == -1:
            return None
        text = text[start:]

        end = text.rfind("}")
        if end != -1:
            try:
                return json.loads(text[:end + 1])
            except json.JSONDecodeError:
                pass

        stack: list[str] = []
        in_str = esc = False
        best: tuple[int, str] | None = None
        for i, ch in enumerate(text):
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch in "{[":
                stack.append(ch)
            elif ch in "}]":
                if not stack:
                    return None
                stack.pop()
                best = (i + 1, "".join(
                    "}" if c == "{" else "]" for c in reversed(stack)
                ))
        if best is None:
            return None
        cut, closers = best
        candidate = text[:cut].rstrip().rstrip(",") + closers
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _chunk_diff(diff_text: str) -> list[str]:
        if len(diff_text) <= CHUNK_SIZE:
            return [diff_text]

        chunks = []
        # Split by file boundaries (diff --git lines)
        files = diff_text.split("\ndiff --git ")
        current_chunk = ""

        for i, file_diff in enumerate(files):
            prefix = "diff --git " if i > 0 else ""
            segment = prefix + file_diff

            # A single file's diff can exceed CHUNK_SIZE on its own — hard-slice
            # it, otherwise the chunk cap is only advisory and oversized requests
            # still hit provider token limits (402/413).
            if len(segment) > CHUNK_SIZE:
                if current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = ""
                chunks.extend(segment[j:j + CHUNK_SIZE]
                              for j in range(0, len(segment), CHUNK_SIZE))
                continue

            if len(current_chunk) + len(segment) > CHUNK_SIZE:
                if current_chunk:
                    chunks.append(current_chunk)
                current_chunk = segment
            else:
                current_chunk += ("\n" if current_chunk else "") + segment

        if current_chunk:
            chunks.append(current_chunk)

        return chunks if chunks else [diff_text[:CHUNK_SIZE]]

    @staticmethod
    def _merge_results(results: list[LLMReviewResult]) -> LLMReviewResult:
        merged = LLMReviewResult()
        summaries = []
        for r in results:
            merged.issues.extend(r.issues)
            merged.security_concerns.extend(r.security_concerns)
            merged.performance_concerns.extend(r.performance_concerns)
            merged.code_smells.extend(r.code_smells)
            merged.suggested_improvements.extend(r.suggested_improvements)
            if r.summary:
                summaries.append(r.summary)
        merged.summary = " ".join(summaries) if summaries else ""
        return merged
