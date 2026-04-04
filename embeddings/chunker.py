"""
Language-aware code chunker.

For Python: uses AST to extract function/class definitions.
For JS/TS: uses regex-based heuristics to extract function/class blocks.
Fallback: splits file into fixed-size overlapping windows.

Each chunk produces a dict:
  {
    "chunk_id":   "<filepath>#<kind>_<name>_L<lineno>",
    "name":       "function or class name (or '')",
    "kind":       "function" | "class" | "block",
    "filepath":   "path/to/file.py",
    "language":   "python" | "javascript" | "typescript" | "other",
    "code":       "<source text>",
  }

chunk_id always includes the start line so duplicate names never collide.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Iterator

# Extensions → language
LANG_MAP: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mjs": "javascript",
    ".cjs": "javascript",
}

# Rough limit: don't embed chunks larger than this many chars
MAX_CHUNK_CHARS = 3000
# Overlap window for fallback chunking
WINDOW_CHARS = 800
OVERLAP_CHARS = 200

# JS/TS: heuristic function/class start patterns
_JS_FUNC_RE = re.compile(
    r"""
    ^[ \t]*                     # leading whitespace
    (?:export\s+)?              # optional export
    (?:default\s+)?             # optional default
    (?:async\s+)?               # optional async
    (?:
        function\s+\*?\s*(\w+)  # function name
        |class\s+(\w+)          # class name
        |(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\()  # arrow/const fn
    )
    """,
    re.VERBOSE | re.MULTILINE,
)


def _detect_language(filepath: str) -> str:
    ext = Path(filepath).suffix.lower()
    return LANG_MAP.get(ext, "other")


def _make_id(filepath: str, kind: str, name: str, lineno: int) -> str:
    """Build a chunk_id that is unique within a file even for same-named symbols."""
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", name) if name else "anon"
    return f"{filepath}#{kind}_{safe_name}_L{lineno}"


def _python_chunks(filepath: str, source: str) -> Iterator[dict]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        yield from _fallback_chunks(filepath, source, "python")
        return

    lines = source.splitlines(keepends=True)

    def _extract(node: ast.AST, kind: str, name: str) -> dict:
        start = node.lineno - 1          # 0-based
        end = node.end_lineno or (start + 1)
        code = "".join(lines[start:end])[:MAX_CHUNK_CHARS]
        return {
            "chunk_id": _make_id(filepath, kind, name, node.lineno),
            "name": name,
            "kind": kind,
            "filepath": filepath,
            "language": "python",
            "code": code,
        }

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield _extract(node, "function", node.name)
        elif isinstance(node, ast.ClassDef):
            yield _extract(node, "class", node.name)


def _js_chunks(filepath: str, source: str, lang: str) -> Iterator[dict]:
    """Brace-counting extraction for JS/TS functions and classes."""
    lines = source.splitlines()
    i = 0
    found_any = False

    while i < len(lines):
        m = _JS_FUNC_RE.match(lines[i])
        if m:
            name = m.group(1) or m.group(2) or m.group(3) or ""
            kind = "class" if m.group(2) else "function"
            start_line = i
            depth = 0
            j = i

            # Advance until we enter the opening brace
            while j < len(lines):
                depth += lines[j].count("{") - lines[j].count("}")
                j += 1
                if depth > 0:
                    break

            # Close the block
            while j < len(lines) and depth > 0:
                depth += lines[j].count("{") - lines[j].count("}")
                j += 1

            code = "\n".join(lines[start_line:j])[:MAX_CHUNK_CHARS]
            yield {
                "chunk_id": _make_id(filepath, kind, name, start_line + 1),
                "name": name,
                "kind": kind,
                "filepath": filepath,
                "language": lang,
                "code": code,
            }
            found_any = True
            i = max(i + 1, j)
        else:
            i += 1

    if not found_any:
        yield from _fallback_chunks(filepath, source, lang)


def _fallback_chunks(filepath: str, source: str,
                     lang: str) -> Iterator[dict]:
    offset = 0
    idx = 0
    while offset < len(source):
        chunk = source[offset: offset + WINDOW_CHARS]
        if not chunk.strip():
            offset += WINDOW_CHARS - OVERLAP_CHARS
            continue
        yield {
            "chunk_id": _make_id(filepath, "block", f"block_{idx}", offset),
            "name": "",
            "kind": "block",
            "filepath": filepath,
            "language": lang,
            "code": chunk,
        }
        idx += 1
        offset += WINDOW_CHARS - OVERLAP_CHARS


def chunk_file(filepath: str, source: str) -> list[dict]:
    """Return all chunks for a single source file."""
    lang = _detect_language(filepath)
    chunks: list[dict] = []

    if lang == "python":
        chunks = list(_python_chunks(filepath, source))
    elif lang in ("javascript", "typescript"):
        chunks = list(_js_chunks(filepath, source, lang))

    # If language-specific extraction yielded nothing, use fallback
    if not chunks:
        chunks = list(_fallback_chunks(filepath, source, lang))

    return chunks
