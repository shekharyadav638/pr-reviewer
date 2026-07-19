"""
Duplicate / reuse detector.

Given the set of files changed in a PR, extracts code chunks and queries
the repo's ChromaDB index to find semantically similar existing code.

Works for Python, JS, TS, and any language with fallback chunking.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

from config.settings import Settings
from embeddings.chunker import chunk_file

logger = logging.getLogger(__name__)

# Cosine similarity threshold above which we flag a duplicate
DUPLICATE_THRESHOLD = 0.92
# Only report at most N candidates per new chunk
TOP_K = 3


@dataclass
class DuplicateWarning:
    new_chunk_name: str
    new_chunk_kind: str          # "function" | "class" | "block"
    new_filepath: str
    existing_name: str
    existing_filepath: str
    existing_language: str
    similarity: float
    existing_code_snippet: str   # first 300 chars

    def to_dict(self) -> dict:
        return {
            "new_chunk_name": self.new_chunk_name,
            "new_chunk_kind": self.new_chunk_kind,
            "new_filepath": self.new_filepath,
            "existing_name": self.existing_name,
            "existing_filepath": self.existing_filepath,
            "existing_language": self.existing_language,
            "similarity": round(self.similarity, 4),
            "existing_code_snippet": self.existing_code_snippet,
        }


class DuplicateDetector:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._collection_cache: dict[str, object] = {}

    def _get_collection(self, workspace: str,
                         repo_slug: str,
                         branch: str = "") -> Optional[object]:
        """
        Load the ChromaDB collection for the given branch.
        Falls back to the legacy (no-branch) collection when no branch-specific
        collection exists yet — so existing repos keep working.
        """
        from embeddings.indexer import collection_exists, get_collection

        # Prefer the branch-specific collection when it's available
        if branch and collection_exists(workspace, repo_slug, branch):
            key = f"{workspace}/{repo_slug}/{branch}"
            if key in self._collection_cache:
                return self._collection_cache[key]
            try:
                col = get_collection(workspace, repo_slug,
                                     self.settings,
                                     branch=branch)
                self._collection_cache[key] = col
                return col
            except Exception as exc:
                logger.warning("Could not load branch collection %s: %s", key, exc)

        # Fallback: legacy no-branch collection
        key = f"{workspace}/{repo_slug}"
        if key not in self._collection_cache:
            try:
                col = get_collection(workspace, repo_slug,
                                     self.settings)
                self._collection_cache[key] = col
            except Exception as exc:
                logger.warning("Could not load collection for %s: %s", key, exc)
                return None

        if branch and key in self._collection_cache:
            logger.warning(
                "PR targets branch '%s' but no branch-specific index found. "
                "Duplicate detection uses the default index — results may miss "
                "code that exists in '%s' but not in the default branch. "
                "Run 'Build Index' for branch '%s' to fix this.",
                branch, branch, branch,
            )
        return self._collection_cache.get(key)

    def detect(
        self,
        workspace: str,
        repo_slug: str,
        file_contents: dict[str, str],
        target_branch: str = "",
    ) -> list[DuplicateWarning]:
        """
        file_contents: {filepath: source_code} for PR-changed files.
        Returns list of DuplicateWarning for any near-duplicate found.
        """
        if not self.settings.resolved_embedding_api_key:
            logger.debug("No embedding API key configured — skipping duplicate detection")
            return []

        collection = self._get_collection(workspace, repo_slug, target_branch)
        if collection is None:
            return []

        try:
            total_chunks = collection.count()
        except Exception:
            total_chunks = 0

        if total_chunks == 0:
            logger.debug("Empty collection for %s/%s — skipping",
                         workspace, repo_slug)
            return []

        warnings: list[DuplicateWarning] = []
        seen_pairs: set[tuple[str, str]] = set()

        for filepath, source in file_contents.items():
            chunks = chunk_file(filepath, source)
            for chunk in chunks:
                if len(chunk["code"].strip()) < 50:
                    continue  # too short to be meaningful

                try:
                    results = collection.query(
                        query_texts=[chunk["code"]],
                        n_results=min(TOP_K + 1, total_chunks),
                        include=["metadatas", "documents", "distances"],
                    )
                except Exception as exc:
                    logger.debug("Query failed for chunk %s: %s",
                                 chunk["chunk_id"], exc)
                    continue

                distances = results.get("distances", [[]])[0]
                metadatas = results.get("metadatas", [[]])[0]
                documents = results.get("documents", [[]])[0]

                for dist, meta, doc in zip(distances, metadatas, documents):
                    # ChromaDB cosine distance = 1 - similarity
                    similarity = 1.0 - dist

                    if similarity < DUPLICATE_THRESHOLD:
                        continue

                    existing_path = meta.get("filepath", "")
                    existing_name = meta.get("name", "")

                    # Skip if it's the same file (PR is modifying the original)
                    if existing_path == filepath:
                        continue

                    pair_key = (chunk["chunk_id"], existing_path)
                    if pair_key in seen_pairs:
                        continue
                    seen_pairs.add(pair_key)

                    warnings.append(DuplicateWarning(
                        new_chunk_name=chunk["name"] or filepath,
                        new_chunk_kind=chunk["kind"],
                        new_filepath=filepath,
                        existing_name=existing_name or existing_path,
                        existing_filepath=existing_path,
                        existing_language=meta.get("language", ""),
                        similarity=similarity,
                        existing_code_snippet=str(doc)[:300],
                    ))

        # Sort by similarity descending
        warnings.sort(key=lambda w: w.similarity, reverse=True)
        return warnings
