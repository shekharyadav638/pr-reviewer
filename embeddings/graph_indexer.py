"""
Graph Indexer — builds AST knowledge graph via code-review-graph MCP tools.

Pipeline after clone:
  1. build_or_update_graph_tool  → parse AST, extract nodes + edges
  2. embed_graph_tool            → compute local embeddings (no API key needed)

The graph is stored by the MCP server in:
  ~/.code-review-graph/<repo_root_hash>/graph.db

We then query it during PR review via graph_reviewer.py.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)


class GraphIndexer:
    """
    Wraps the code-review-graph MCP tools.
    Falls back gracefully if crg CLI is not installed.
    """

    def __init__(self):
        self._crg_available = self._check_crg()

    def _check_crg(self) -> bool:
        for candidate in [["code-review-graph", "--version"],
                          ["python", "-m", "code_review_graph", "--version"]]:
            try:
                result = subprocess.run(candidate, capture_output=True, text=True)
                if result.returncode == 0:
                    logger.info("code-review-graph found: %s", result.stdout.strip())
                    return True
            except FileNotFoundError:
                continue
        logger.warning(
            "code-review-graph not found. Install with: "
            "pip install code-review-graph[embeddings]\n"
            "Graph-based features will be unavailable."
        )
        return False

    def _crg_cmd(self) -> list[str]:
        """Return the code-review-graph command prefix."""
        try:
            subprocess.run(["code-review-graph", "--version"],
                           capture_output=True, check=True)
            return ["code-review-graph"]
        except (FileNotFoundError, subprocess.CalledProcessError):
            return ["python", "-m", "code_review_graph"]

    def build_graph(
        self,
        repo_root: Path,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> int:
        """
        Build or update the AST graph for the cloned repo.
        Returns number of nodes indexed.
        """
        def _prog(pct: int, msg: str):
            logger.info("[graph %d%%] %s", pct, msg)
            if progress_callback:
                progress_callback(pct, msg)

        if not self._crg_available:
            _prog(100, "Skipped — code-review-graph not installed")
            return 0

        if not repo_root.exists():
            raise ValueError(f"Repo root does not exist: {repo_root}")

        _prog(5, "Building AST knowledge graph…")

        cmd = self._crg_cmd() + ["build", "--repo", str(repo_root)]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True, text=True,
                cwd=str(repo_root),
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or result.stdout.strip())
            _prog(70, "Graph built. Running post-processing…")
        except Exception as exc:
            raise RuntimeError(f"Graph build failed: {exc}")

        # Post-process: flows, communities, FTS index
        try:
            pp_cmd = self._crg_cmd() + ["postprocess", "--repo", str(repo_root)]
            result = subprocess.run(pp_cmd, capture_output=True, text=True,
                                    cwd=str(repo_root))
            if result.returncode != 0:
                logger.warning("Postprocess failed (non-fatal): %s",
                               result.stderr.strip())
            else:
                _prog(90, "Post-processing complete.")
        except Exception as exc:
            logger.warning("Postprocess step failed (non-fatal): %s", exc)

        # Get stats
        nodes = self._get_node_count(repo_root)
        _prog(100, f"Graph complete. {nodes} nodes indexed.")
        return nodes

    def _get_node_count(self, repo_root: Path) -> int:
        if not self._crg_available:
            return 0
        try:
            cmd = self._crg_cmd() + ["status", "--repo", str(repo_root)]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                import re
                m = re.search(r"(\d+)\s+node", result.stdout)
                if m:
                    return int(m.group(1))
        except Exception:
            pass
        return 0

    def get_impact_for_files(
        self,
        repo_root: Path,
        changed_files: list[str],
        max_depth: int = 2,
    ) -> dict:
        """
        Given a list of changed file paths, return impact analysis:
        affected functions, flows, risk scores.
        Uses crg CLI directly (no git needed — we pass files explicitly).
        """
        if not self._crg_available or not repo_root.exists():
            return {}
        try:
            import json
            files_arg = ",".join(changed_files)
            cmd = self._crg_cmd() + [
                "impact", str(repo_root),
                "--files", files_arg,
                "--depth", str(max_depth),
                "--json",
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return json.loads(result.stdout)
        except Exception as exc:
            logger.debug("Impact analysis failed: %s", exc)
        return {}

    def search_similar(
        self,
        repo_root: Path,
        query: str,
        kind: Optional[str] = None,
        limit: int = 5,
    ) -> list[dict]:
        """Semantic search across the graph for similar functions/classes."""
        if not self._crg_available or not repo_root.exists():
            return []
        try:
            import json
            cmd = self._crg_cmd() + [
                "search", str(repo_root), query,
                "--limit", str(limit),
                "--json",
            ]
            if kind:
                cmd += ["--kind", kind]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return json.loads(result.stdout)
        except Exception as exc:
            logger.debug("Graph search failed: %s", exc)
        return []

    def get_architecture_overview(self, repo_root: Path) -> dict:
        """Return module communities and architecture summary."""
        if not self._crg_available or not repo_root.exists():
            return {}
        try:
            import json
            cmd = self._crg_cmd() + [
                "architecture", str(repo_root), "--json"
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return json.loads(result.stdout)
        except Exception as exc:
            logger.debug("Architecture overview failed: %s", exc)
        return {}

    @property
    def available(self) -> bool:
        return self._crg_available
