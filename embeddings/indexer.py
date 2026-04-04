"""
Repo Indexer — builds a ChromaDB vector index for a Bitbucket repository.

Usage:
    indexer = RepoIndexer(settings)
    indexer.index_repo(workspace, repo_slug, progress_callback=None)

The index is stored under  data/chroma/<workspace>_<repo_slug>/
Each document is a code chunk (function / class / block).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Callable, Optional

import chromadb
from chromadb.utils import embedding_functions

from bitbucket.client import BitbucketClient
from config.settings import Settings
from embeddings.chunker import chunk_file, LANG_MAP

logger = logging.getLogger(__name__)

# Source file extensions we care about
SOURCE_EXTENSIONS = set(LANG_MAP.keys()) | {".go", ".java", ".rb", ".rs",
                                              ".cpp", ".c", ".cs", ".php",
                                              ".swift", ".kt"}

CHROMA_BASE = Path("data/chroma")


def _collection_name(workspace: str, repo_slug: str) -> str:
    # ChromaDB collection names must match [a-zA-Z0-9_-]{3,63}
    raw = f"{workspace}_{repo_slug}"
    name = re.sub(r"[^a-zA-Z0-9_-]", "_", raw)[:63]
    if len(name) < 3:
        name = name + "_col"
    return name


def get_chroma_client(workspace: str, repo_slug: str) -> chromadb.ClientAPI:
    path = CHROMA_BASE / f"{workspace}_{repo_slug}"
    path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(path))


def get_collection(workspace: str, repo_slug: str,
                   openai_api_key: str) -> chromadb.Collection:
    client = get_chroma_client(workspace, repo_slug)
    ef = embedding_functions.OpenAIEmbeddingFunction(
        api_key=openai_api_key,
        model_name="text-embedding-3-small",
    )
    name = _collection_name(workspace, repo_slug)
    return client.get_or_create_collection(
        name=name,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )


class RepoIndexer:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = BitbucketClient(settings)

    def _list_source_files(self, workspace: str,
                            repo_slug: str) -> list[str]:
        """Return all source file paths on the main/master branch."""
        base = self.settings.bitbucket_base_url.rstrip("/")
        # Try main then master
        for branch in ("main", "master", "develop"):
            url = (f"{base}/repositories/{workspace}/{repo_slug}"
                   f"/src/{branch}/")
            paths: list[str] = []
            self._walk_tree(url, paths, workspace, repo_slug, branch)
            if paths:
                return paths
        return []

    def _walk_tree(self, url: str, paths: list[str],
                   workspace: str, repo_slug: str, branch: str,
                   depth: int = 0) -> None:
        if depth > 10:
            return
        try:
            data = self.client._get_paginated(url, max_items=500)
        except Exception as exc:
            logger.debug("Could not list %s: %s", url, exc)
            return

        base = self.settings.bitbucket_base_url.rstrip("/")
        for item in data:
            if item.get("type") == "commit_file":
                fp = item.get("path", "")
                ext = Path(fp).suffix.lower()
                if ext in SOURCE_EXTENSIONS:
                    paths.append(fp)
            elif item.get("type") == "commit_directory":
                sub_url = (f"{base}/repositories/{workspace}/{repo_slug}"
                           f"/src/{branch}/{item['path']}/")
                self._walk_tree(sub_url, paths, workspace, repo_slug,
                                branch, depth + 1)

    def index_repo(
        self,
        workspace: str,
        repo_slug: str,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> int:
        """
        Index all source files in the repo.
        Returns the total number of chunks indexed.
        progress_callback(percent: int, message: str)
        """
        if not self.settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required for repo indexing")

        def _prog(pct: int, msg: str) -> None:
            if progress_callback:
                progress_callback(pct, msg)
            logger.info("[%d%%] %s", pct, msg)

        _prog(2, "Listing source files...")
        file_paths = self._list_source_files(workspace, repo_slug)
        if not file_paths:
            raise ValueError(
                f"No source files found in {workspace}/{repo_slug}. "
                "Check credentials and repo path."
            )

        _prog(5, f"Found {len(file_paths)} source files. Fetching content...")

        collection = get_collection(workspace, repo_slug,
                                    self.settings.openai_api_key)

        # Get the current head commit for all files
        base = self.settings.bitbucket_base_url.rstrip("/")
        head = self._get_head_commit(workspace, repo_slug)

        total = len(file_paths)
        indexed_chunks = 0
        batch_docs: list[str] = []
        batch_ids: list[str] = []
        batch_metas: list[dict] = []
        BATCH_SIZE = 50  # embed 50 chunks at a time

        for file_idx, filepath in enumerate(file_paths):
            pct = 5 + int(90 * file_idx / total)
            _prog(pct, f"Processing {filepath} ({file_idx+1}/{total})")

            try:
                content = self.client.get_file_content(
                    workspace, repo_slug, head, filepath
                )
            except Exception:
                logger.debug("Skipping %s — could not fetch", filepath)
                continue

            if not content or not content.strip():
                continue

            chunks = chunk_file(filepath, content)
            for chunk in chunks:
                # Use scoped chunk_id to avoid collisions across repos
                cid = f"{workspace}/{repo_slug}:{chunk['chunk_id']}"
                batch_ids.append(cid)
                batch_docs.append(chunk["code"])
                batch_metas.append({
                    "workspace": workspace,
                    "repo_slug": repo_slug,
                    "filepath": chunk["filepath"],
                    "name": chunk["name"],
                    "kind": chunk["kind"],
                    "language": chunk["language"],
                })

                if len(batch_ids) >= BATCH_SIZE:
                    collection.upsert(
                        ids=batch_ids,
                        documents=batch_docs,
                        metadatas=batch_metas,
                    )
                    indexed_chunks += len(batch_ids)
                    batch_ids, batch_docs, batch_metas = [], [], []

        # Flush remaining
        if batch_ids:
            collection.upsert(
                ids=batch_ids,
                documents=batch_docs,
                metadatas=batch_metas,
            )
            indexed_chunks += len(batch_ids)

        _prog(100, f"Done. Indexed {indexed_chunks} chunks.")
        return indexed_chunks

    def _get_head_commit(self, workspace: str, repo_slug: str) -> str:
        base = self.settings.bitbucket_base_url.rstrip("/")
        for branch in ("main", "master", "develop"):
            try:
                data = self.client._get(
                    f"{base}/repositories/{workspace}/{repo_slug}"
                    f"/refs/branches/{branch}"
                )
                return data["target"]["hash"]
            except Exception:
                continue
        return "HEAD"
