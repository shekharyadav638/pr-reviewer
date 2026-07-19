import json
import logging
import re

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

# Only long-lived environment branches get cloned/indexed — feature/ticket
# branches are always cut from one of these, so indexing them separately is
# pure duplication and burns disk/embedding cost for no benefit.
MAIN_BRANCH_NAMES = {
    "master", "main", "dev", "develop", "stage", "staging",
    "production", "prod", "release", "qa", "uat",
}
# Ticket branches: "DF-754-...", or namespaced "DF-754/...", "feature/...",
# "hotfix/...", "fix/...", "bugfix/...", "chore/...", "task/..."
_TICKET_ID_RE = re.compile(r"^[a-z]{2,10}-\d+", re.IGNORECASE)
_WORKFLOW_PREFIX_RE = re.compile(
    r"^(feature|feat|fix|hotfix|bugfix|chore|task)/", re.IGNORECASE
)


def _is_main_branch(name: str) -> bool:
    """True only for long-lived environment branches, never ticket/feature work."""
    n = name.strip().lower()
    if "/" in n or _WORKFLOW_PREFIX_RE.match(n) or _TICKET_ID_RE.match(n):
        return False
    return n in MAIN_BRANCH_NAMES


def _parse_json_list(value: str) -> list:
    try:
        result = json.loads(value or "[]")
        return result if isinstance(result, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


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
        # Auto-sync the local clone so duplicate detection + graph use fresh code
        try:
            workspace, repo_slug, _ = __import__(
                "bitbucket.client", fromlist=["BitbucketClient"]
            ).BitbucketClient.parse_pr_url(pr_url)
            self._auto_sync_clone(workspace, repo_slug)
        except Exception:
            pass  # sync is best-effort — analysis continues regardless
        builder = self._get_hybrid_builder()
        report: HybridReport = builder.build_report(pr_url)
        return self._to_hybrid_response(report)

    def get_cached_pr_review(self, repo_id: int, pr_id: int) -> dict | None:
        """Return the cached review result for a PR, or None if never analysed."""
        return self._repo_store().get_pr_review(repo_id, pr_id)

    def save_pr_review_cache(self, repo_id: int, pr_id: int, result: dict) -> None:
        """Persist an analysis result so all users can see it without re-running."""
        self._repo_store().save_pr_review(repo_id, pr_id, result)


    def _auto_sync_clone(self, workspace: str, repo_slug: str) -> None:
        """Quick git fetch on the cloned repo before analysis."""
        from repos.cloner import clone_dir
        if not clone_dir(workspace, repo_slug).exists():
            return
        store = self._repo_store()
        records = store.list_repos()
        record = next(
            (r for r in records
             if r.workspace == workspace and r.repo_slug == repo_slug),
            None,
        )
        if not record:
            return
        import logging
        logger = logging.getLogger(__name__)
        try:
            cloner = self._make_cloner()
            cloner.sync(
                workspace, repo_slug,
                branch=record.default_branch or "",
                git_url=record.git_url or "",
            )
            logger.info("Auto-synced clone for %s/%s", workspace, repo_slug)
        except Exception as exc:
            logger.warning("Auto-sync failed for %s/%s: %s", workspace, repo_slug, exc)

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

        # Ask Bitbucket what the repo's default branch actually is —
        # never assume "main"; plenty of repos still default to "master".
        default_branch = "main"
        try:
            bb = self._make_bb_client()
            default_branch = (
                bb.get_default_branch(workspace, repo_slug) or default_branch
            )
        except Exception as exc:
            logger.warning("Could not fetch default branch for %s/%s (%s) — "
                           "assuming 'main'", workspace, repo_slug, exc)

        store = self._repo_store()
        record = store.add_repo(workspace, repo_slug, git_url=git_url,
                                default_branch=default_branch)
        return self._repo_to_response(record)

    def delete_repo(self, repo_id: int) -> dict:
        from pathlib import Path

        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")

        # 1 & 2. Delete every clone + ChromaDB dir for this repo, across
        # every branch ever indexed (not just the legacy no-branch path).
        self._purge_branch_data(record.workspace, record.repo_slug, keep_branches=set())

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
        Full pipeline (background) for the main branches only (see MAIN_BRANCHES):
          For each matching branch fetched from Bitbucket:
            1. Sparse-shallow clone
            2. Build AST graph
            3. Build ChromaDB vector index
        Progress is reported as a fraction of total branches completed.
        Feature/ticket branches are skipped — they're checked out from a main
        branch anyway, so indexing them separately just duplicates content.
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
            from embeddings.graph_indexer import GraphIndexer
            from embeddings.indexer import RepoIndexer
            from repos.cloner import clone_dir

            settings = Settings.load()
            cloner   = self._make_cloner()

            # ── Fetch branch list from Bitbucket, keep only main branches ──
            bb = self._make_bb_client()
            try:
                all_branches = bb.get_branches(record.workspace, record.repo_slug)
                branches = [b for b in all_branches if _is_main_branch(b)]
            except Exception as exc:
                logger.warning("Could not fetch branches from Bitbucket (%s) — "
                               "falling back to the repo's default branch", exc)
                branches = []

            if not branches:
                # None of the fetched branches matched a known env-branch name
                # (or the fetch failed) — ask Bitbucket what the repo's actual
                # default branch is instead of assuming "main". Repos like
                # drupal-fit-portal still default to "master", not "main".
                actual_default = ""
                try:
                    actual_default = bb.get_default_branch(record.workspace, record.repo_slug)
                except Exception as exc:
                    logger.warning("Could not fetch default branch for %s/%s: %s",
                                   record.workspace, record.repo_slug, exc)
                fallback = actual_default or record.default_branch or "main"
                if fallback != record.default_branch:
                    store.update_default_branch(repo_id, fallback)
                branches = [fallback]

            # Prune any previously cloned/indexed branch that's no longer in
            # the filtered set — cleans up ticket-branch clutter left behind
            # by runs from before the main-branch filter existed.
            self._purge_branch_data(record.workspace, record.repo_slug,
                                    keep_branches=set(branches))
            store.reset_indexed_branches(repo_id, [])
            store.update_branches(repo_id, branches)
            total = len(branches)
            logger.info("Indexing %d branches for repo %d: %s",
                        total, repo_id, branches)

            for idx, br in enumerate(branches):
                store.set_current_branch(repo_id, br, total=total)

                # Overall clone/index progress = fraction of branches done
                overall_pct = int(idx * 100 / total)
                store.update_clone_status(repo_id, "cloning", progress=overall_pct)
                store.update_index_status(repo_id, "indexing", progress=overall_pct)

                # ── Step 1: Clone ──────────────────────────────────────
                try:
                    cloner.clone(
                        record.git_url,
                        record.workspace, record.repo_slug,
                        branch=br,
                    )
                    logger.info("[%s] Clone done", br)
                except Exception as exc:
                    logger.error("[%s] Clone failed: %s", br, exc)
                    store.update_clone_status(repo_id, "error", error=f"{br}: {exc}")
                    continue  # skip graph + index for this branch, try next

                # ── Step 2: AST graph ──────────────────────────────────
                store.update_graph_status(repo_id, "building", progress=0)
                try:
                    gi = GraphIndexer()
                    nodes = gi.build_graph(
                        clone_dir(record.workspace, record.repo_slug, br),
                    )
                    store.update_graph_status(
                        repo_id, "built", progress=100,
                        nodes=nodes,
                        built_at=datetime.utcnow().isoformat(),
                    )
                    logger.info("[%s] Graph: %d nodes", br, nodes)
                except Exception as exc:
                    logger.warning("[%s] Graph build failed: %s", br, exc)
                    store.update_graph_status(repo_id, "error", error=f"{br}: {exc}")
                    # Continue — ChromaDB index is still useful without graph

                # ── Step 3: ChromaDB vector index ──────────────────────
                try:
                    indexer = RepoIndexer(settings)
                    count = indexer.index_repo(
                        record.workspace, record.repo_slug,
                        branch=br,
                    )
                    store.mark_branch_indexed(repo_id, br)
                    logger.info("[%s] Chroma: %d chunks", br, count)
                except Exception as exc:
                    logger.error("[%s] Chroma indexing failed: %s", br, exc)
                    store.update_index_status(repo_id, "error", error=f"{br}: {exc}")
                    continue

            # ── All branches done ──────────────────────────────────────
            size_mb = sum(
                cloner.disk_usage_mb(record.workspace, record.repo_slug, br)
                for br in branches
            )
            store.update_clone_status(
                repo_id, "cloned", progress=100,
                size_mb=size_mb,
                cloned_at=datetime.utcnow().isoformat(),
            )
            store.update_index_status(
                repo_id, "indexed", progress=100,
                indexed_at=datetime.utcnow().isoformat(),
            )
            store.set_current_branch(repo_id, "", total=total)
            logger.info("All %d branches indexed for repo %d", total, repo_id)

        threading.Thread(target=_run, daemon=True).start()
        return {"status": "build_started", "repo_id": repo_id}

    def sync_repo(self, repo_id: int) -> dict:
        """Pull latest + rebuild graph for every indexed branch (background)."""
        import threading
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")

        # Determine which branches to sync: prefer already-indexed ones,
        # fall back to the known branches list, then the default branch.
        indexed = _parse_json_list(getattr(record, "indexed_branches", "[]"))
        known   = _parse_json_list(getattr(record, "branches", "[]"))
        branches_to_sync = indexed or known or [record.default_branch or "main"]

        store.update_clone_status(repo_id, "cloning", progress=0)

        def _run():
            from datetime import datetime
            from embeddings.graph_indexer import GraphIndexer
            from repos.cloner import clone_dir

            cloner = self._make_cloner()
            total  = len(branches_to_sync)

            for idx, br in enumerate(branches_to_sync):
                store.set_current_branch(repo_id, br, total=total)
                overall_pct = int(idx * 100 / total)
                store.update_clone_status(repo_id, "cloning", progress=overall_pct)

                # ── git fetch + reset ──────────────────────────────────
                try:
                    cloner.sync(
                        record.workspace, record.repo_slug,
                        branch=br,
                        git_url=record.git_url,
                    )
                    logger.info("[sync] %s done", br)
                except Exception as exc:
                    logger.error("[sync] %s failed: %s", br, exc)
                    store.update_clone_status(repo_id, "error", error=f"{br}: {exc}")
                    continue

                # ── incremental graph rebuild ──────────────────────────
                store.update_graph_status(repo_id, "building", progress=0)
                try:
                    gi = GraphIndexer()
                    nodes = gi.build_graph(
                        clone_dir(record.workspace, record.repo_slug, br),
                    )
                    store.update_graph_status(
                        repo_id, "built", progress=100, nodes=nodes,
                        built_at=datetime.utcnow().isoformat(),
                    )
                    logger.info("[sync] %s graph: %d nodes", br, nodes)
                except Exception as exc:
                    logger.warning("[sync] %s graph failed: %s", br, exc)
                    store.update_graph_status(repo_id, "error", error=f"{br}: {exc}")

            size_mb = sum(
                cloner.disk_usage_mb(record.workspace, record.repo_slug, br)
                for br in branches_to_sync
            )
            store.update_clone_status(
                repo_id, "cloned", progress=100, size_mb=size_mb,
                cloned_at=datetime.utcnow().isoformat(),
            )
            store.set_current_branch(repo_id, "", total=total)
            logger.info("Sync complete for %d branches (repo %d)", total, repo_id)

        threading.Thread(target=_run, daemon=True).start()
        return {"status": "sync_started", "repo_id": repo_id,
                "branches": branches_to_sync}

    def checkout_branch(self, repo_id: int, branch: str) -> dict:
        """No-op in branch-per-dir model — the frontend just switches which branch it reads."""
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        indexed = _parse_json_list(record.indexed_branches)
        if branch not in indexed:
            raise ValueError(f"Branch '{branch}' is not indexed yet")
        return {"status": "ok", "branch": branch}

    def list_branches(self, repo_id: int) -> list[str]:
        """Return indexed branches from DB — these have clone dirs on disk."""
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        indexed = _parse_json_list(record.indexed_branches)
        if indexed:
            return indexed
        # Fallback: all known branches from Bitbucket API stored in DB
        return _parse_json_list(record.branches)

    def browse_source(self, repo_id: int, path: str = "", branch: str = "") -> list[dict]:
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        branch = self._resolve_branch(record, branch)
        cloner = self._make_cloner()
        return cloner.browse(record.workspace, record.repo_slug, path, branch)

    def read_source_file(self, repo_id: int, path: str, branch: str = "") -> dict:
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        branch = self._resolve_branch(record, branch)
        cloner = self._make_cloner()
        content = cloner.read_file(record.workspace, record.repo_slug, path, branch)
        return {"path": path, "content": content}

    def get_source_head_commit(self, repo_id: int, branch: str = "") -> dict | None:
        store = self._repo_store()
        record = store.get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        branch = self._resolve_branch(record, branch)
        cloner = self._make_cloner()
        return cloner.get_head_commit(record.workspace, record.repo_slug, branch)

    def _resolve_branch(self, record, branch: str) -> str:
        """Pick the branch to serve source from. Uses the first indexed branch as default."""
        if branch:
            return branch
        indexed = _parse_json_list(record.indexed_branches)
        if indexed:
            return indexed[0]
        return record.default_branch or ""

    def _make_cloner(self):
        from repos.cloner import RepoCloner
        settings = Settings.load()
        username = settings.bitbucket_username
        # Bitbucket git auth requires the account username, not an email.
        # Resolve it from /user if the configured value looks like an email.
        if "@" in username and settings.bitbucket_app_password:
            try:
                bb = self._make_bb_client()
                user_info = bb._get(f"{settings.bitbucket_base_url}/user")
                username = user_info.get("username") or username
            except Exception:
                pass
        return RepoCloner(
            username=username,
            password=settings.bitbucket_app_password,
        )

    def _make_bb_client(self):
        from bitbucket.client import BitbucketClient as BBC
        return BBC(Settings.load())

    def _purge_branch_data(self, workspace: str, repo_slug: str,
                           keep_branches: set[str]) -> None:
        """Delete every on-disk clone/chroma dir for this repo whose branch
        isn't in `keep_branches` (pass an empty set to wipe everything).
        Cleans up data left behind by ticket branches that got cloned/indexed
        before the main-branch filter existed."""
        import shutil
        from pathlib import Path

        prefix = f"{workspace}_{repo_slug}"
        for base in (Path("data/clones"), Path("data/chroma")):
            if not base.exists():
                continue
            for entry in base.iterdir():
                if not entry.is_dir():
                    continue
                if entry.name == prefix:
                    branch = ""  # legacy no-branch path
                elif entry.name.startswith(prefix + "__"):
                    branch = entry.name[len(prefix) + 2:]
                else:
                    continue
                if branch not in keep_branches:
                    logger.info("Pruning stale indexed data: %s", entry)
                    shutil.rmtree(entry, ignore_errors=True)

    # ------------------------------------------------------------------ #
    # Bitbucket webhook registration                                        #
    # ------------------------------------------------------------------ #

    def register_webhook(self, repo_id: int, callback_url: str) -> dict:
        record = self._repo_store().get_repo(repo_id)
        if not record:
            raise ValueError(f"Repo {repo_id} not found")
        client = self._make_bb_client()
        try:
            existing = client.list_webhooks(record.workspace, record.repo_slug)
            for hook in existing:
                if hook.get("url") == callback_url:
                    return {"status": "already_registered", "url": callback_url}
            result = client.register_webhook(record.workspace, record.repo_slug, callback_url)
            return {"status": "registered", "url": callback_url, "uuid": result.get("uuid", "")}
        except Exception as exc:
            import requests as _req
            if isinstance(exc, _req.exceptions.HTTPError) and exc.response is not None:
                if exc.response.status_code == 403:
                    return {
                        "status": "permission_denied",
                        "message": "App password lacks 'Webhooks' scope. "
                                   "Go to Bitbucket → Personal settings → App passwords → "
                                   "edit your password and enable Webhooks (read+write).",
                    }
            raise

    # ------------------------------------------------------------------ #
    # Bitbucket repo discovery                                             #
    # ------------------------------------------------------------------ #

    def list_bitbucket_repos(self) -> list[dict]:
        """Return cached Bitbucket repo listing (instant). Empty if never refreshed."""
        return self._repo_store().get_bb_repo_cache()

    def refresh_bitbucket_repos(self) -> list[dict]:
        """Fetch fresh repo listing from Bitbucket API, save to cache, return it."""
        client = self._make_bb_client()
        raw_repos = client.list_all_repos()
        result = []
        for r in raw_repos:
            ws = r.get("_workspace_slug", "") or (
                r.get("workspace", {}).get("slug", "") if isinstance(r.get("workspace"), dict) else ""
            )
            result.append({
                "workspace":   ws,
                "slug":        r.get("slug", ""),
                "full_name":   r.get("full_name", ""),
                "description": r.get("description", "") or "",
                "is_private":  r.get("is_private", False),
                "language":    r.get("language", "") or "",
                "updated_on":  r.get("updated_on", ""),
                "size":        r.get("size", 0),
            })
        self._repo_store().save_bb_repo_cache(result)
        return result

    # ------------------------------------------------------------------ #
    # Webhook: auto-review on PR creation                                  #
    # ------------------------------------------------------------------ #

    def handle_pr_created_webhook(self, payload: dict) -> dict:
        """
        Triggered by Bitbucket's pullrequest:created webhook.
        Finds the matching connected repo, runs hybrid analysis, posts issues.
        """
        import threading

        pr_data    = payload.get("pullrequest", {})
        repo_data  = payload.get("repository", {})
        ws_data    = repo_data.get("workspace", {})

        workspace  = ws_data.get("slug", "")
        # Bitbucket webhooks put the slug in full_name ("workspace/repo") not slug
        repo_slug  = repo_data.get("slug", "")
        if not repo_slug:
            full_name = repo_data.get("full_name", "")
            if "/" in full_name:
                workspace = workspace or full_name.split("/")[0]
                repo_slug = full_name.split("/")[1]
        pr_id      = pr_data.get("id")
        pr_links   = pr_data.get("links") or {}
        pr_html    = (pr_links.get("html") or {}).get("href", "")

        logger.info("Webhook payload: workspace=%r repo=%r pr_id=%r", workspace, repo_slug, pr_id)

        if not (workspace and repo_slug and pr_id):
            logger.warning("Webhook ignored: missing fields (workspace=%r repo=%r pr_id=%r)",
                           workspace, repo_slug, pr_id)
            return {"status": "ignored", "reason": "missing fields"}

        # Only process if the repo is connected
        store   = self._repo_store()
        records = store.list_repos()
        connected = [(r.workspace, r.repo_slug) for r in records]
        logger.info("Webhook: connected repos = %s", connected)
        record  = next(
            (r for r in records
             if r.workspace == workspace and r.repo_slug == repo_slug),
            None,
        )
        if not record:
            logger.warning("Webhook ignored: %s/%s not in connected repos %s",
                           workspace, repo_slug, connected)
            return {"status": "ignored", "reason": "repo not connected"}

        pr_url = pr_html or (
            f"https://bitbucket.org/{workspace}/{repo_slug}/pull-requests/{pr_id}"
        )

        def _run():
            try:
                logger.info("Webhook: auto-reviewing PR #%s for %s/%s", pr_id, workspace, repo_slug)
                report = self._get_hybrid_builder().build_report(pr_url)
                review_data = self._to_hybrid_response(report).model_dump()
                self.post_review_comments(record.id, pr_id, review_data)
                logger.info("Webhook: posted review comments on PR #%s", pr_id)
            except Exception as exc:
                logger.exception("Webhook auto-review failed for PR #%s: %s", pr_id, exc)

        threading.Thread(target=_run, daemon=True).start()
        return {"status": "review_started", "pr_id": pr_id, "workspace": workspace, "repo": repo_slug}

    @staticmethod
    def _to_git_url(repo_url: str) -> str:
        """Normalise any URL/slug to a cloneable HTTPS git URL."""
        url = repo_url.strip().rstrip("/")

        # Already HTTPS
        if url.startswith("http://") or url.startswith("https://"):
            if not url.endswith(".git"):
                url += ".git"
            return url

        # SSH → convert to HTTPS so http.extraheader auth works
        # git@bitbucket.org:ws/repo.git  →  https://bitbucket.org/ws/repo.git
        # git@github.com:ws/repo.git     →  https://github.com/ws/repo.git
        if url.startswith("git@"):
            # Remove git@ prefix, split host and path at ':'
            rest = url[len("git@"):]
            if ":" in rest:
                host, path = rest.split(":", 1)
            else:
                raise ValueError(f"Cannot parse SSH URL: {repo_url}")
            if not path.endswith(".git"):
                path += ".git"
            return f"https://{host}/{path}"

        # workspace/repo shorthand — assume Bitbucket
        parts = [p for p in url.split("/") if p]
        if len(parts) == 2:
            slug = parts[1] if parts[1].endswith(".git") else parts[1] + ".git"
            return f"https://bitbucket.org/{parts[0]}/{slug}"
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
                source_branch=((pr.get("source") or {}).get("branch") or {}).get("name", ""),
                target_branch=((pr.get("destination") or {}).get("branch") or {}).get("name", ""),
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
                "path": (d.get("new") or d.get("old") or {}).get("path", ""),
                "lines_added": d.get("lines_added", 0),
                "lines_removed": d.get("lines_removed", 0),
                "status": d.get("status", "modified"),
            }
            for d in diff_stat
        ]
        return {"diff": raw_diff, "files": files}

    def post_review_comments(self, repo_id: int, pr_id: int,
                             review_data: dict) -> dict:
        """Post every AI-detected issue as an inline comment on the Bitbucket PR."""
        from collections import defaultdict

        # ── Parse diff to find first added line per file ─────────────────
        diff_data = self.get_pr_diff(repo_id, pr_id)
        file_first_lines = self._parse_first_lines(diff_data.get("diff", ""))

        def resolve_line(filepath: str, explicit_line: int | None) -> int | None:
            if explicit_line:
                return explicit_line
            # Exact match first
            if filepath in file_first_lines:
                return file_first_lines[filepath]
            # Suffix match (e.g. issue has "file.js", diff has "src/utils/file.js")
            for k, v in file_first_lines.items():
                if k.endswith("/" + filepath) or k == filepath:
                    return v
            return None

        # Build {file: [suggestions]} from llm_improvements
        improvements: dict[str, list[str]] = {}
        for imp in review_data.get("llm_improvements", []):
            f = (imp.get("file") or "").strip()
            desc = (imp.get("description") or "").strip()
            if f and desc:
                improvements.setdefault(f, []).append(desc)

        # Group issues by (filepath, line) ─────────────────────────────────
        groups: dict[tuple[str, int], list[dict]] = defaultdict(list)

        def collect(category: str, items: list[dict], has_line: bool = False):
            for item in items:
                fp = (item.get("file") or "").strip()
                if not fp:
                    continue
                explicit = item.get("line") if has_line else None
                ln = resolve_line(fp, explicit)
                if not ln:
                    continue
                groups[(fp, ln)].append({
                    "category": category,
                    "severity": (item.get("severity") or "").upper(),
                    "description": item.get("description") or item.get("message") or "",
                    "rule": item.get("rule", ""),
                })

        collect("Code Issue",       review_data.get("llm_detected_issues", []))
        collect("Security",         review_data.get("llm_security_concerns", []))
        collect("Performance",      review_data.get("llm_performance_concerns", []))
        collect("Code Smell",       review_data.get("llm_code_smells", []))
        collect("Static Analysis",  review_data.get("static_analysis_issues", []), has_line=True)

        _sev_icon = {
            "CRITICAL": "🔴", "HIGH": "🔴", "ERROR": "🔴",
            "MEDIUM": "🟡", "WARNING": "🟡",
            "LOW": "🔵", "INFO": "🔵",
        }

        posted = skipped = 0
        for (fp, ln), issues in groups.items():
            lines = ["**PR Guardian — AI Review**", ""]
            for iss in issues:
                icon = _sev_icon.get(iss["severity"], "⚪")
                rule = f" `{iss['rule']}`" if iss.get("rule") else ""
                sev = f" **{iss['severity']}**" if iss["severity"] else ""
                lines.append(f"{icon} **[{iss['category']}]**{sev}{rule}")
                lines.append(f"{iss['description']}")
                lines.append("")

            # Append improvements for this file
            file_imps = improvements.get(fp, [])
            if file_imps:
                lines.append("💡 **Suggested improvements:**")
                for s in file_imps:
                    lines.append(f"- {s}")

            text = "\n".join(lines).rstrip()
            try:
                self.post_pr_comment(repo_id, pr_id, text, fp, ln)
                posted += 1
            except Exception as exc:
                logger.warning("Failed to post inline comment at %s:%d — %s", fp, ln, exc)
                skipped += 1

        return {"posted": posted, "skipped": skipped, "total": posted + skipped}

    @staticmethod
    def _parse_first_lines(raw_diff: str) -> dict[str, int]:
        """Return {filepath: first_new_line_number} for every changed file in the diff."""
        import re
        result: dict[str, int] = {}
        current_file: str | None = None
        new_line = 0

        for raw in raw_diff.split("\n"):
            if raw.startswith("+++ b/"):
                current_file = raw[6:]
                new_line = 0
            elif raw.startswith("@@ ") and current_file:
                m = re.search(r"\+(\d+)", raw)
                new_line = int(m.group(1)) if m else 0
            elif current_file and raw.startswith("+") and not raw.startswith("+++"):
                if current_file not in result:
                    result[current_file] = new_line
                new_line += 1
            elif current_file and not raw.startswith("-") and not raw.startswith("\\"):
                new_line += 1

        return result

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
        """Parse any git URL/slug → (workspace, repo_slug).

        Handles:
          https://bitbucket.org/ws/repo(.git)
          git@bitbucket.org:ws/repo(.git)
          git@github.com:ws/repo(.git)
          ws/repo
        """
        url = repo_url.strip().rstrip("/")

        # SSH URL: git@host:workspace/repo.git
        if url.startswith("git@"):
            colon_idx = url.index(":") if ":" in url else -1
            if colon_idx == -1:
                raise ValueError(f"Cannot parse SSH URL: {repo_url}")
            path_part = url[colon_idx + 1:]  # oslabsdevelopment/fmea-node.git
            parts = [p.removesuffix(".git") for p in path_part.split("/") if p]
            if len(parts) < 2:
                raise ValueError(f"Cannot parse repo from SSH URL: {repo_url}")
            return parts[0], parts[1]

        # HTTPS URL
        if url.startswith("http://") or url.startswith("https://"):
            from urllib.parse import urlparse
            path_parts = [p.removesuffix(".git")
                          for p in urlparse(url).path.strip("/").split("/") if p]
            if len(path_parts) < 2:
                raise ValueError(f"Cannot parse repo URL: {repo_url}")
            return path_parts[0], path_parts[1]

        # workspace/repo shorthand
        parts = [p.removesuffix(".git") for p in url.split("/") if p]
        if len(parts) != 2:
            raise ValueError(
                f"Invalid repo format '{repo_url}'. "
                "Expected 'workspace/repo', full HTTPS URL, or SSH URL."
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
            branches=_parse_json_list(getattr(record, "branches", "[]")),
            indexed_branches=_parse_json_list(getattr(record, "indexed_branches", "[]")),
            current_branch=getattr(record, "current_branch", ""),
            total_branches=getattr(record, "total_branches", 0),
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
