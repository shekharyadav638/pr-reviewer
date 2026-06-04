"""
Repo Indexer — builds a ChromaDB vector index by reading the local sparse clone.

Provider-agnostic: reads files from data/clones/<workspace>_<repo>/
instead of calling any provider API.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Callable, Optional

import chromadb
from chromadb.utils import embedding_functions

from config.settings import Settings
from embeddings.chunker import chunk_file, LANG_MAP
from repos.cloner import clone_dir

logger = logging.getLogger(__name__)

SOURCE_EXTENSIONS = set(LANG_MAP.keys()) | {
    ".go", ".java", ".rb", ".rs", ".cpp", ".c",
    ".cs", ".php", ".swift", ".kt",
}

CHROMA_BASE = Path("data/chroma")


def _collection_name(workspace: str, repo_slug: str, branch: str = "") -> str:
    """
    Each branch gets its own collection so develop and stage embeddings
    never collide. Default (no branch) preserves backward-compat naming.
    """
    raw = f"{workspace}_{repo_slug}" + (f"__{branch}" if branch else "")
    name = re.sub(r"[^a-zA-Z0-9_-]", "_", raw)[:63]
    return name if len(name) >= 3 else name + "_col"


def get_chroma_client(workspace: str, repo_slug: str,
                       branch: str = "") -> chromadb.ClientAPI:
    suffix = f"__{branch}" if branch else ""
    path = CHROMA_BASE / f"{workspace}_{repo_slug}{suffix}"
    path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(path))


def get_collection(workspace: str, repo_slug: str,
                   openai_api_key: str,
                   branch: str = "") -> chromadb.Collection:
    """Return (or create) the ChromaDB collection for a specific branch."""
    client = get_chroma_client(workspace, repo_slug, branch)
    ef = embedding_functions.OpenAIEmbeddingFunction(
        api_key=openai_api_key,
        model_name="text-embedding-3-small",
    )
    name = _collection_name(workspace, repo_slug, branch)
    return client.get_or_create_collection(
        name=name,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )


def collection_exists(workspace: str, repo_slug: str,
                       branch: str = "") -> bool:
    """Return True if a non-empty ChromaDB collection exists for this branch."""
    suffix = f"__{branch}" if branch else ""
    path = CHROMA_BASE / f"{workspace}_{repo_slug}{suffix}"
    return path.exists() and any(path.iterdir())


class RepoIndexer:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _list_source_files(self, clone_path: Path) -> list[Path]:
        """Walk the local clone and return all source files."""
        files = []
        for path in clone_path.rglob("*"):
            if not path.is_file():
                continue
            # Skip .git internals
            if ".git" in path.parts:
                continue
            if path.suffix.lower() in SOURCE_EXTENSIONS:
                files.append(path)
        return files

    def index_repo(
        self,
        workspace: str,
        repo_slug: str,
        branch: str = "",
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> int:
        """
        Index all source files from the local sparse clone.
        `branch` scopes the clone path and ChromaDB collection so that
        develop and stage never share the same index.
        Returns total number of chunks indexed.
        """
        if not self.settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required for repo indexing")

        def _prog(pct: int, msg: str) -> None:
            if progress_callback:
                progress_callback(pct, msg)
            logger.info("[%d%%] %s", pct, msg)

        clone_path = clone_dir(workspace, repo_slug, branch)
        if not clone_path.exists():
            # Fall back to legacy (no-branch) path for backward compat
            clone_path = clone_dir(workspace, repo_slug)
        if not clone_path.exists():
            raise ValueError(
                f"No local clone found at {clone_path}. "
                "Run 'Build Index' to clone the repo first."
            )

        _prog(2, "Scanning local clone for source files…")
        source_files = self._list_source_files(clone_path)
        if not source_files:
            raise ValueError(
                f"No source files found in local clone at {clone_path}. "
                "The clone may be empty or only contain excluded file types."
            )

        _prog(5, f"Found {len(source_files)} source files. Building embeddings…")

        collection = get_collection(workspace, repo_slug,
                                    self.settings.openai_api_key,
                                    branch=branch)

        total = len(source_files)
        indexed_chunks = 0
        batch_docs: list[str] = []
        batch_ids: list[str] = []
        batch_metas: list[dict] = []
        BATCH_SIZE = 50

        for file_idx, abs_path in enumerate(source_files):
            pct = 5 + int(90 * file_idx / total)
            rel_path = str(abs_path.relative_to(clone_path))
            _prog(pct, f"Processing {rel_path} ({file_idx + 1}/{total})")

            try:
                content = abs_path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                logger.debug("Skipping %s — could not read", rel_path)
                continue

            if not content.strip():
                continue

            chunks = chunk_file(rel_path, content)
            for chunk in chunks:
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

        if batch_ids:
            collection.upsert(
                ids=batch_ids,
                documents=batch_docs,
                metadatas=batch_metas,
            )
            indexed_chunks += len(batch_ids)

        _prog(100, f"Done. Indexed {indexed_chunks} chunks.")
        return indexed_chunks
