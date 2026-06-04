"""
Graph Reviewer — enriches PR review context using the AST knowledge graph.

During a PR review it:
  1. Looks up impact radius for changed files (what else gets affected)
  2. Searches for semantically similar existing functions (duplicate detection)
  3. Returns structured context injected into the LLM prompt
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from embeddings.graph_indexer import GraphIndexer
from repos.cloner import clone_dir

logger = logging.getLogger(__name__)


@dataclass
class GraphReviewContext:
    available: bool = False
    graph_nodes: int = 0

    # Impact analysis
    affected_functions: list[dict] = field(default_factory=list)
    affected_flows: list[dict] = field(default_factory=list)
    risk_score_boost: float = 0.0
    impact_summary: str = ""

    # Duplicate / reuse (graph-aware, more precise than vector-only)
    graph_duplicates: list[dict] = field(default_factory=list)

    # Architecture
    affected_communities: list[str] = field(default_factory=list)

    def to_llm_context(self) -> str:
        """Format as a compact text block to inject into LLM prompt."""
        if not self.available:
            return ""

        lines = ["## Repository Graph Context\n"]

        if self.impact_summary:
            lines.append(f"**Impact Summary:** {self.impact_summary}\n")

        if self.affected_functions:
            lines.append(
                f"**Affected Functions ({len(self.affected_functions)}):** "
                + ", ".join(
                    f['name'] for f in self.affected_functions[:10]
                ) + "\n"
            )

        if self.affected_flows:
            lines.append("**Affected Execution Flows:**")
            for flow in self.affected_flows[:5]:
                lines.append(f"  - {flow.get('name', '?')} "
                             f"(depth: {flow.get('depth', '?')})")
            lines.append("")

        if self.affected_communities:
            lines.append(
                f"**Affected Modules:** "
                f"{', '.join(self.affected_communities[:5])}\n"
            )

        if self.graph_duplicates:
            lines.append("**Potential Duplicate Code (graph-detected):**")
            for dup in self.graph_duplicates[:5]:
                lines.append(
                    f"  - `{dup.get('query_name')}` is similar to "
                    f"`{dup.get('name')}` in {dup.get('file')}"
                )
            lines.append("")

        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "available": self.available,
            "graph_nodes": self.graph_nodes,
            "affected_functions": self.affected_functions,
            "affected_flows": self.affected_flows,
            "risk_score_boost": self.risk_score_boost,
            "impact_summary": self.impact_summary,
            "graph_duplicates": self.graph_duplicates,
            "affected_communities": self.affected_communities,
        }


class GraphReviewer:
    def __init__(self):
        self._indexer = GraphIndexer()

    def analyze(
        self,
        workspace: str,
        repo_slug: str,
        changed_files: list[str],
        file_contents: Optional[dict[str, str]] = None,
        target_branch: str = "",
    ) -> GraphReviewContext:
        ctx = GraphReviewContext()

        if not self._indexer.available:
            return ctx

        # Use the branch-specific clone when it exists, fall back to default.
        repo_root = clone_dir(workspace, repo_slug, target_branch)
        if not repo_root.exists():
            repo_root = clone_dir(workspace, repo_slug)
        if not repo_root.exists():
            logger.debug("No clone found for %s/%s — skipping graph review",
                         workspace, repo_slug)
            return ctx

        ctx.available = True

        # 1. Impact analysis for changed files
        try:
            impact = self._indexer.get_impact_for_files(
                repo_root, changed_files, max_depth=2
            )
            if impact:
                ctx.affected_functions = impact.get("affected_functions", [])
                ctx.affected_flows     = impact.get("affected_flows", [])
                ctx.affected_communities = impact.get("communities", [])
                ctx.impact_summary     = impact.get("summary", "")

                # Boost risk if critical flows are affected
                critical_flows = sum(
                    1 for f in ctx.affected_flows
                    if f.get("criticality", 0) > 0.7
                )
                ctx.risk_score_boost = min(0.15, critical_flows * 0.05)
        except Exception as exc:
            logger.debug("Impact analysis failed: %s", exc)

        # 2. Graph-based duplicate detection
        # For each changed file, search for similar functions in the graph
        if file_contents:
            try:
                for filepath, source in list(file_contents.items())[:5]:
                    # Use the first meaningful function name as query
                    func_names = self._extract_names(source)
                    for name in func_names[:3]:
                        results = self._indexer.search_similar(
                            repo_root, name, kind="Function", limit=3
                        )
                        for r in results:
                            # Skip if it's in the same file
                            if r.get("file") == filepath:
                                continue
                            if r.get("score", 0) > 0.85:
                                ctx.graph_duplicates.append({
                                    "query_name": name,
                                    "query_file": filepath,
                                    **r,
                                })
            except Exception as exc:
                logger.debug("Graph duplicate search failed: %s", exc)

        return ctx

    def _extract_names(self, source: str) -> list[str]:
        """Quick regex extraction of function/class names from source."""
        import re
        names = []
        for pattern in [
            r"def\s+(\w+)\s*\(",         # Python
            r"function\s+(\w+)\s*\(",    # JS/TS
            r"class\s+(\w+)",            # Any
            r"const\s+(\w+)\s*=.*=>",    # Arrow functions
        ]:
            names.extend(re.findall(pattern, source))
        # Filter trivial names
        return [n for n in names if len(n) > 3 and n not in (
            "self", "this", "true", "false", "None", "null"
        )]
