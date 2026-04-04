import json
import logging
import os
from dataclasses import dataclass, field

from openai import OpenAI

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

MAX_DIFF_CHARS = 80_000
CHUNK_SIZE = 60_000


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
    def __init__(self, api_key: str | None = None,
                 model: str = "gpt-4.1"):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.model = model
        if not self.api_key:
            raise ValueError(
                "OpenAI API key not set. "
                "Set OPENAI_API_KEY in your .env file."
            )
        self.client = OpenAI(api_key=self.api_key)

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
                       extra_context: str = "") -> LLMReviewResult:
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
        except Exception:
            logger.exception("OpenAI API call failed")
            return LLMReviewResult(
                summary="LLM analysis failed due to an API error."
            )

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
            logger.warning("Failed to parse LLM JSON response, "
                           "returning raw as summary")
            return LLMReviewResult(summary=raw[:2000])

        return LLMReviewResult(
            issues=data.get("issues", []),
            security_concerns=data.get("security_concerns", []),
            performance_concerns=data.get("performance_concerns", []),
            code_smells=data.get("code_smells", []),
            suggested_improvements=data.get("suggested_improvements", []),
            summary=data.get("summary", ""),
        )

    @staticmethod
    def _chunk_diff(diff_text: str) -> list[str]:
        if len(diff_text) <= MAX_DIFF_CHARS:
            return [diff_text]

        chunks = []
        # Split by file boundaries (diff --git lines)
        files = diff_text.split("\ndiff --git ")
        current_chunk = ""

        for i, file_diff in enumerate(files):
            prefix = "diff --git " if i > 0 else ""
            segment = prefix + file_diff

            if len(current_chunk) + len(segment) > CHUNK_SIZE:
                if current_chunk:
                    chunks.append(current_chunk)
                current_chunk = segment
            else:
                current_chunk += ("\n" if current_chunk else "") + segment

        if current_chunk:
            chunks.append(current_chunk)

        return chunks if chunks else [diff_text[:MAX_DIFF_CHARS]]

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
