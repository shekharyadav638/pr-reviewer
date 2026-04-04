import logging

from analysis.analyzer import AnalysisReport, PRAnalyzer
from api.schemas import (
    AnalyzeResponse,
    DetectedIssue,
    DuplicateWarningItem,
    HybridAnalyzeResponse,
    LLMImprovementItem,
    LLMIssueItem,
    PRListItem,
    RawMetrics,
    RepoResponse,
    StaticAnalysisIssueItem,
    VulnerabilityItem,
)
from config.settings import Settings
from hybrid.report_builder import HybridReport, HybridReportBuilder

logger = logging.getLogger(__name__)


class AnalysisService:
    def __init__(self) -> None:
        self._analyzer: PRAnalyzer | None = None
        self._hybrid_builder: HybridReportBuilder | None = None

    def _get_analyzer(self) -> PRAnalyzer:
        if self._analyzer is None:
            settings = Settings.load()
            self._analyzer = PRAnalyzer(settings)
            try:
                self._analyzer.load_model()
                logger.info("ML model loaded successfully")
            except FileNotFoundError:
                logger.warning("No trained model found — rule-based analysis only")
            self._analyzer.load_dataset()
        return self._analyzer

    def _get_hybrid_builder(self) -> HybridReportBuilder:
        if self._hybrid_builder is None:
            settings = Settings.load()
            self._hybrid_builder = HybridReportBuilder(settings)
        return self._hybrid_builder

    def analyze(self, pr_url: str) -> AnalyzeResponse:
        analyzer = self._get_analyzer()
        report: AnalysisReport = analyzer.analyze_pr(pr_url)
        return self._to_response(report)

    def analyze_hybrid(self, pr_url: str) -> HybridAnalyzeResponse:
        builder = self._get_hybrid_builder()
        report: HybridReport = builder.build_report(pr_url)
        return self._to_hybrid_response(report)

    def trigger_retraining(self) -> dict:
        import numpy as np
        from dataset.builder import DatasetBuilder
        from features.engineering import FeatureEngineer
        from models.trainer import ModelTrainer
        
        settings = Settings.load()
        builder = DatasetBuilder(settings)
        try:
            df = builder.load("pr_dataset.csv")
        except FileNotFoundError:
            raise ValueError("No base dataset found for retraining. Run collect_data.py first.")

        if len(df) < 10:
            raise ValueError(f"Only {len(df)} PRs in dataset. Need more data to train.")

        engineer = FeatureEngineer()
        X = engineer.fit_transform(df)
        y = df["needs_major_changes"].values.astype(int)

        if len(np.unique(y)) < 2:
            raise ValueError("Dataset has only one class. Need positive and negative examples.")

        trainer = ModelTrainer()
        trainer.train_and_evaluate(X, y)

        trainer.save(settings.model_output_dir)
        engineer.save(settings.model_output_dir)

        # Hot-reload the model
        self._analyzer = None
        self._get_analyzer()

        return {
            "status": "success",
            "message": f"Retrained successfully. Best model: {trainer.best_model_name}",
            "dataset_size": len(df)
        }

    def record_feedback(self, pr_url: str, user_corrected_risk: int) -> dict:
        analyzer = self._get_analyzer()
        return analyzer.record_feedback(pr_url, user_corrected_risk)

    # ------------------------------------------------------------------ #
    # Repo management                                                       #
    # ------------------------------------------------------------------ #

    def _repo_store(self):
        from repos.store import RepoStore
        return RepoStore()

    def list_repos(self) -> list[RepoResponse]:
        store = self._repo_store()
        return [self._repo_to_response(r) for r in store.list_repos()]

    def add_repo(self, repo_url: str) -> RepoResponse:
        workspace, repo_slug = self._parse_repo_url(repo_url)
        # Normalise to https clone URL
        git_url = self._to_git_url(repo_url)
        store = self._repo_store()
        record = store.add_repo(workspace, repo_slug, git_url=git_url)
        return self._repo_to_response(record)

    def delete_repo(self, repo_id: int) -> dict:
        import shutil
        from pathlib import Path

        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")

        from repos.cloner import RepoCloner
        cloner = self._make_cloner()

        # 1. Delete sparse clone from disk
        cloner.delete_clone(record.workspace, record.repo_slug)

        # 2. Delete ChromaDB vector index
        chroma_dir = Path("data/chroma") / f"{record.workspace}_{record.repo_slug}"
        if chroma_dir.exists():
            shutil.rmtree(chroma_dir)

        # 3. Delete training CSV
        settings = Settings.load()
        safe_name = f"{record.workspace}_{record.repo_slug}".replace("/", "_")
        csv_path = Path(settings.data_output_dir) / f"{safe_name}_prs.csv"
        if csv_path.exists():
            csv_path.unlink()

        # 4. Clear cached builders
        self._hybrid_builder = None

        # 5. Remove from SQLite
        store.delete_repo(repo_id)
        return {"status": "deleted", "repo_id": repo_id}

    def start_index_repo(self, repo_id: int) -> dict:
        """
        Full pipeline (background):
          1. Sparse-shallow clone the repo
          2. Build AST graph (code-review-graph MCP)
          3. Build ChromaDB vector embeddings (duplicate detection)
        """
        import threading
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        if not record.git_url:
            raise ValueError(
                f"Repo {repo_id} has no git URL. "
                "Please remove and re-add with a full git URL."
            )

        store.update_clone_status(repo_id, "cloning", progress=0)

        def _run():
            from datetime import datetime
            settings = Settings.load()
            cloner = self._make_cloner()

            # ── Step 1: Clone ──────────────────────────────────────────
            try:
                def _clone_prog(pct: int, _msg: str):
                    store.update_clone_status(repo_id, "cloning", progress=pct)

                cloner.clone(
                    record.git_url,
                    record.workspace, record.repo_slug,
                    branch=record.default_branch,
                    progress_callback=_clone_prog,
                )
                size_mb = cloner.disk_usage_mb(record.workspace, record.repo_slug)
                store.update_clone_status(
                    repo_id, "cloned", progress=100,
                    size_mb=size_mb,
                    cloned_at=datetime.utcnow().isoformat(),
                )
                logger.info("Clone done (%.1f MB) for repo %d", size_mb, repo_id)
            except Exception as exc:
                logger.exception("Clone failed for repo %d", repo_id)
                store.update_clone_status(repo_id, "error", error=str(exc))
                return

            # ── Step 2: AST graph ──────────────────────────────────────
            store.update_graph_status(repo_id, "building", progress=0)
            try:
                from embeddings.graph_indexer import GraphIndexer
                gi = GraphIndexer()

                def _graph_prog(pct: int, _msg: str):
                    store.update_graph_status(repo_id, "building", progress=pct)

                from repos.cloner import clone_dir
                nodes = gi.build_graph(
                    clone_dir(record.workspace, record.repo_slug),
                    full_rebuild=True,
                    progress_callback=_graph_prog,
                )
                store.update_graph_status(
                    repo_id, "built", progress=100,
                    nodes=nodes,
                    built_at=datetime.utcnow().isoformat(),
                )
                logger.info("Graph built (%d nodes) for repo %d", nodes, repo_id)
            except Exception as exc:
                logger.exception("Graph build failed for repo %d", repo_id)
                store.update_graph_status(repo_id, "error", error=str(exc))
                # continue — chroma index is still useful without graph

            # ── Step 3: ChromaDB vector index ──────────────────────────
            store.update_index_status(repo_id, "indexing", progress=0)
            try:
                from embeddings.indexer import RepoIndexer
                indexer = RepoIndexer(settings)

                def _chroma_prog(pct: int, _msg: str):
                    store.update_index_status(repo_id, "indexing", progress=pct)

                count = indexer.index_repo(
                    record.workspace, record.repo_slug,
                    progress_callback=_chroma_prog,
                )
                store.update_index_status(
                    repo_id, "indexed", progress=100,
                    indexed_at=datetime.utcnow().isoformat(),
                )
                logger.info("Chroma: %d chunks for repo %d", count, repo_id)
            except Exception as exc:
                logger.exception("Chroma indexing failed for repo %d", repo_id)
                store.update_index_status(repo_id, "error", error=str(exc))

        threading.Thread(target=_run, daemon=True).start()
        return {"status": "build_started", "repo_id": repo_id}

    def sync_repo(self, repo_id: int, branch: str = "") -> dict:
        """Pull latest code and rebuild graph/index (background)."""
        import threading
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")

        store.update_clone_status(repo_id, "cloning", progress=0)

        def _run():
            from datetime import datetime
            cloner = self._make_cloner()
            target_branch = branch or record.default_branch

            try:
                def _prog(pct: int, _msg: str):
                    store.update_clone_status(repo_id, "cloning", progress=pct)

                cloner.sync(
                    record.workspace, record.repo_slug,
                    branch=target_branch,
                    git_url=record.git_url,
                    progress_callback=_prog,
                )
                if branch and branch != record.default_branch:
                    store.update_default_branch(repo_id, branch)

                size_mb = cloner.disk_usage_mb(record.workspace, record.repo_slug)
                store.update_clone_status(
                    repo_id, "cloned", progress=100, size_mb=size_mb,
                    cloned_at=datetime.utcnow().isoformat(),
                )
            except Exception as exc:
                logger.exception("Sync failed for repo %d", repo_id)
                store.update_clone_status(repo_id, "error", error=str(exc))
                return

            # Rebuild graph incrementally
            store.update_graph_status(repo_id, "building", progress=0)
            try:
                from embeddings.graph_indexer import GraphIndexer
                from repos.cloner import clone_dir
                gi = GraphIndexer()
                nodes = gi.build_graph(
                    clone_dir(record.workspace, record.repo_slug),
                    full_rebuild=False,
                )
                store.update_graph_status(
                    repo_id, "built", progress=100, nodes=nodes,
                    built_at=datetime.utcnow().isoformat(),
                )
            except Exception as exc:
                logger.exception("Graph rebuild failed for repo %d", repo_id)
                store.update_graph_status(repo_id, "error", error=str(exc))

        threading.Thread(target=_run, daemon=True).start()
        return {"status": "sync_started", "repo_id": repo_id,
                "branch": branch or record.default_branch}

    def list_branches(self, repo_id: int) -> list[str]:
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        cloner = self._make_cloner()
        return cloner.list_branches(record.workspace, record.repo_slug)

    def browse_source(self, repo_id: int, path: str = "") -> list[dict]:
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        cloner = self._make_cloner()
        return cloner.browse(record.workspace, record.repo_slug, path)

    def read_source_file(self, repo_id: int, path: str) -> dict:
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        cloner = self._make_cloner()
        content = cloner.read_file(record.workspace, record.repo_slug, path)
        return {"path": path, "content": content}

    def _make_cloner(self):
        from repos.cloner import RepoCloner
        settings = Settings.load()
        return RepoCloner(
            username=settings.bitbucket_username,
            password=settings.bitbucket_app_password,
        )

    @staticmethod
    def _to_git_url(repo_url: str) -> str:
        """Convert any repo URL/slug to a cloneable https URL."""
        url = repo_url.strip().rstrip("/")
        if url.startswith("http://") or url.startswith("https://"):
            if not url.endswith(".git"):
                url += ".git"
            return url
        if url.startswith("git@"):
            return url
        # workspace/repo shorthand — assume Bitbucket
        parts = url.split("/")
        if len(parts) == 2:
            return f"https://bitbucket.org/{parts[0]}/{parts[1]}.git"
        return url

    def get_repo_prs(self, repo_id: int,
                     state: str = "OPEN") -> list[PRListItem]:
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")

        settings = Settings.load()
        from bitbucket.client import BitbucketClient as BBC
        client = BBC(settings)
        prs = client.get_pull_requests(
            record.workspace, record.repo_slug,
            state=state, limit=100,
        )
        items = []
        for pr in prs:
            author_data = pr.get("author") or {}
            author = author_data.get("display_name",
                                     author_data.get("nickname", ""))
            items.append(PRListItem(
                pr_id=pr["id"],
                title=pr.get("title", ""),
                author=author,
                state=pr.get("state", ""),
                created_at=pr.get("created_on", ""),
                updated_at=pr.get("updated_on", ""),
                pr_url=(
                    f"https://bitbucket.org/{record.workspace}/"
                    f"{record.repo_slug}/pull-requests/{pr['id']}"
                ),
            ))
        return items

    def start_fetch_repo_prs(self, repo_id: int) -> dict:
        """
        Fetch up to 1000 historical PRs (MERGED + DECLINED) and save them
        to data/training/<workspace>_<repo_slug>_prs.csv for ML training.
        """
        import threading
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")

        store.update_pr_fetch_status(repo_id, "fetching")

        def _run():
            try:
                import os
                import pandas as pd
                from bitbucket.client import BitbucketClient as BBC

                settings = Settings.load()
                client = BBC(settings)
                all_prs = []

                for state in ("MERGED", "DECLINED"):
                    logger.info("Fetching %s PRs for repo %d...", state, repo_id)
                    raw_prs = client.get_pull_requests(
                        record.workspace, record.repo_slug,
                        state=state, limit=500,
                    )
                    for pr_raw in raw_prs:
                        try:
                            pr_data = client.extract_pr_data(
                                record.workspace, record.repo_slug, pr_raw
                            )
                            all_prs.append(pr_data)
                        except Exception:
                            logger.debug("Skipping PR #%s", pr_raw.get("id"))

                # Save to CSV so it can be used for ML training
                if all_prs:
                    out_dir = settings.data_output_dir
                    os.makedirs(out_dir, exist_ok=True)
                    safe_name = f"{record.workspace}_{record.repo_slug}".replace("/", "_")
                    csv_path = os.path.join(out_dir, f"{safe_name}_prs.csv")
                    df = pd.DataFrame(all_prs)
                    df.to_csv(csv_path, index=False)
                    logger.info("Saved %d PRs to %s", len(all_prs), csv_path)

                store.update_pr_fetch_status(
                    repo_id, "done", pr_count=len(all_prs)
                )

                # Auto-train the ML model on the freshly fetched data
                self._auto_train(all_prs, settings)

            except Exception as exc:
                logger.exception("PR fetch failed for repo %d", repo_id)
                store.update_pr_fetch_status(
                    repo_id, "error", error=str(exc)
                )

        threading.Thread(target=_run, daemon=True).start()
        return {"status": "fetch_started", "repo_id": repo_id}

    def get_pr_diff(self, repo_id: int, pr_id: int) -> dict:
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        settings = Settings.load()
        from bitbucket.client import BitbucketClient as BBC
        client = BBC(settings)
        raw_diff = client.get_pr_diff(record.workspace, record.repo_slug, pr_id)
        diff_stat = client.get_pr_diff_stat(record.workspace, record.repo_slug, pr_id)
        files = [
            {
                "path": d.get("new", d.get("old", {})).get("path", ""),
                "lines_added": d.get("lines_added", 0),
                "lines_removed": d.get("lines_removed", 0),
                "status": d.get("status", "modified"),
            }
            for d in diff_stat
        ]
        return {"diff": raw_diff, "files": files}

    def post_pr_comment(self, repo_id: int, pr_id: int,
                        text: str, filepath: str, line: int) -> dict:
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        settings = Settings.load()
        from bitbucket.client import BitbucketClient as BBC
        client = BBC(settings)
        url = (
            f"{settings.bitbucket_base_url}/repositories/"
            f"{record.workspace}/{record.repo_slug}/pullrequests/{pr_id}/comments"
        )
        payload = {
            "content": {"raw": text},
            "inline": {"path": filepath, "to": line},
        }
        resp = client.session.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        return {"status": "posted", "comment_id": resp.json().get("id")}

    def _auto_train(self, all_prs: list[dict], settings: Settings) -> None:
        """
        Label the fetched PRs and train the ML model automatically.
        Skips silently if there is not enough data for a meaningful model.
        """
        import numpy as np
        from dataset.builder import DatasetBuilder
        from dataset.labeler import Labeler
        from features.engineering import FeatureEngineer
        from models.trainer import ModelTrainer

        try:
            if len(all_prs) < 10:
                logger.info(
                    "Auto-train skipped: only %d PRs (need ≥10)", len(all_prs)
                )
                return

            # Label the data using the same heuristics as the manual pipeline
            import pandas as pd
            labeler = Labeler(settings)
            df = labeler.generate_labels(pd.DataFrame(all_prs))

            y = df["needs_major_changes"].values.astype(int)
            if len(np.unique(y)) < 2:
                logger.info(
                    "Auto-train skipped: all %d PRs have the same label "
                    "(need both positive and negative examples)", len(df)
                )
                return

            engineer = FeatureEngineer()
            X = engineer.fit_transform(df)

            trainer = ModelTrainer()
            trainer.train_and_evaluate(X, y)
            trainer.save(settings.model_output_dir)
            engineer.save(settings.model_output_dir)

            # Hot-reload so the next review uses the new model immediately
            self._analyzer = None
            self._hybrid_builder = None
            logger.info(
                "Auto-train complete. Best model: %s", trainer.best_model_name
            )
        except Exception:
            logger.exception("Auto-train failed — model unchanged")

    @staticmethod
    def _parse_repo_url(repo_url: str) -> tuple[str, str]:
        """Parse  https://bitbucket.org/ws/repo  or  ws/repo  → (ws, repo)."""
        url = repo_url.strip().rstrip("/")
        if "bitbucket.org" in url:
            from urllib.parse import urlparse
            parts = [p for p in urlparse(url).path.strip("/").split("/") if p]
            if len(parts) < 2:
                raise ValueError(f"Cannot parse repo URL: {repo_url}")
            return parts[0], parts[1]
        parts = url.split("/")
        if len(parts) != 2 or not parts[0] or not parts[1]:
            raise ValueError(
                f"Invalid repo format '{repo_url}'. "
                "Expected 'workspace/repo' or full Bitbucket URL."
            )
        return parts[0], parts[1]

    @staticmethod
    def _repo_to_response(record) -> RepoResponse:
        return RepoResponse(
            id=record.id,
            workspace=record.workspace,
            repo_slug=record.repo_slug,
            display_name=record.display_name,
            git_url=getattr(record, "git_url", ""),
            default_branch=getattr(record, "default_branch", "main"),
            added_at=record.added_at,
            clone_status=getattr(record, "clone_status", "pending"),
            clone_progress=getattr(record, "clone_progress", 0),
            clone_error=getattr(record, "clone_error", ""),
            clone_size_mb=getattr(record, "clone_size_mb", 0.0),
            cloned_at=getattr(record, "cloned_at", None),
            graph_status=getattr(record, "graph_status", "pending"),
            graph_progress=getattr(record, "graph_progress", 0),
            graph_error=getattr(record, "graph_error", ""),
            graph_nodes=getattr(record, "graph_nodes", 0),
            graph_built_at=getattr(record, "graph_built_at", None),
            index_status=record.index_status,
            index_progress=record.index_progress,
            index_error=record.index_error,
            indexed_at=record.indexed_at,
            pr_fetch_status=record.pr_fetch_status,
            pr_count=record.pr_count,
            pr_fetch_error=record.pr_fetch_error,
        )

    @staticmethod
    def _to_response(report: AnalysisReport) -> AnalyzeResponse:
        return AnalyzeResponse(
            pr_id=report.pr_id,
            pr_title=report.pr_title,
            pr_author=report.pr_author,
            repo=report.repo,
            risk_level=report.risk_level,
            risk_score=report.risk_score,
            reasons=report.reasons,
            problematic_files=report.problematic_files,
            detected_issues=[
                DetectedIssue(**issue) for issue in report.detected_issues
            ],
            hotspot_files=report.hotspot_files,
            recommendations=report.review_focus,
            metrics=RawMetrics(**report.raw_metrics),
        )

    @staticmethod
    def _to_hybrid_response(report: HybridReport) -> HybridAnalyzeResponse:
        return HybridAnalyzeResponse(
            pr_id=report.pr_id,
            pr_title=report.pr_title,
            pr_author=report.pr_author,
            repo=report.repo,
            risk_level=report.risk_level,
            risk_score=report.risk_score,
            ml_reasons=report.ml_reasons,
            rule_issues=[
                DetectedIssue(**issue) for issue in report.rule_issues
            ],
            hotspot_files=report.hotspot_files,
            metrics=RawMetrics(**report.metrics) if report.metrics else RawMetrics(),
            security_warnings=[
                VulnerabilityItem(**v) for v in report.security_warnings
            ],
            static_analysis_issues=[
                StaticAnalysisIssueItem(**i)
                for i in report.static_analysis_issues
            ],
            static_tools_run=report.static_tools_run,
            static_tools_unavailable=report.static_tools_unavailable,
            llm_detected_issues=[
                LLMIssueItem(**i) for i in report.llm_detected_issues
                if isinstance(i, dict)
            ],
            llm_security_concerns=[
                LLMIssueItem(**i) for i in report.llm_security_concerns
                if isinstance(i, dict)
            ],
            llm_performance_concerns=[
                LLMIssueItem(**i) for i in report.llm_performance_concerns
                if isinstance(i, dict)
            ],
            llm_code_smells=[
                LLMIssueItem(**i) for i in report.llm_code_smells
                if isinstance(i, dict)
            ],
            llm_improvements=[
                LLMImprovementItem(**i) for i in report.llm_improvements
                if isinstance(i, dict)
            ],
            llm_summary=report.llm_summary,
            duplicate_warnings=[
                DuplicateWarningItem(**w) for w in report.duplicate_warnings
                if isinstance(w, dict)
            ],
            recommendations=report.recommendations,
            review_focus=report.review_focus,
            graph_context=report.graph_context,
        )
