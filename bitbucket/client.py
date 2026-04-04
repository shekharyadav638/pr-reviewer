import logging
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import requests

from config.settings import Settings

logger = logging.getLogger(__name__)


class BitbucketClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.session = requests.Session()
        self.session.auth = (
            settings.bitbucket_username,
            settings.bitbucket_app_password,
        )
        self.base_url = settings.bitbucket_base_url.rstrip("/")

    def _get(self, url: str, params: dict | None = None) -> dict:
        resp = self.session.get(url, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _get_paginated(self, url: str, params: dict | None = None,
                       max_items: int = 100) -> list[dict]:
        results = []
        params = params or {}
        while url and len(results) < max_items:
            data = self._get(url, params)
            values = data.get("values", [])
            results.extend(values)
            url = data.get("next")
            params = {}  # next URL already contains params
        return results[:max_items]

    def get_pull_requests(self, workspace: str, repo_slug: str,
                          state: str = "MERGED",
                          limit: int = 100) -> list[dict]:
        url = f"{self.base_url}/repositories/{workspace}/{repo_slug}/pullrequests"
        params = {"state": state, "pagelen": min(limit, 50)}
        return self._get_paginated(url, params, max_items=limit)

    def get_pr_detail(self, workspace: str, repo_slug: str,
                      pr_id: int) -> dict:
        url = (f"{self.base_url}/repositories/{workspace}/{repo_slug}"
               f"/pullrequests/{pr_id}")
        return self._get(url)

    def get_pr_diff_stat(self, workspace: str, repo_slug: str,
                         pr_id: int) -> list[dict]:
        url = (f"{self.base_url}/repositories/{workspace}/{repo_slug}"
               f"/pullrequests/{pr_id}/diffstat")
        return self._get_paginated(url, max_items=500)

    def get_pr_comments(self, workspace: str, repo_slug: str,
                        pr_id: int) -> list[dict]:
        url = (f"{self.base_url}/repositories/{workspace}/{repo_slug}"
               f"/pullrequests/{pr_id}/comments")
        return self._get_paginated(url, max_items=200)

    def get_pr_activity(self, workspace: str, repo_slug: str,
                        pr_id: int) -> list[dict]:
        url = (f"{self.base_url}/repositories/{workspace}/{repo_slug}"
               f"/pullrequests/{pr_id}/activity")
        return self._get_paginated(url, max_items=200)

    def get_pr_commits(self, workspace: str, repo_slug: str,
                       pr_id: int) -> list[dict]:
        url = (f"{self.base_url}/repositories/{workspace}/{repo_slug}"
               f"/pullrequests/{pr_id}/commits")
        return self._get_paginated(url, max_items=200)

    def get_pr_diff(self, workspace: str, repo_slug: str,
                    pr_id: int) -> str:
        """Fetch the raw unified diff for a PR."""
        url = (f"{self.base_url}/repositories/{workspace}/{repo_slug}"
               f"/pullrequests/{pr_id}/diff")
        resp = self.session.get(url, timeout=60)
        resp.raise_for_status()
        return resp.text

    def get_file_content(self, workspace: str, repo_slug: str,
                         commit: str, filepath: str) -> str:
        """Fetch raw file content at a specific commit."""
        url = (f"{self.base_url}/repositories/{workspace}/{repo_slug}"
               f"/src/{commit}/{filepath}")
        resp = self.session.get(url, timeout=30)
        if resp.status_code == 404:
            return ""
        resp.raise_for_status()
        return resp.text

    def extract_pr_data(self, workspace: str, repo_slug: str,
                        pr_raw: dict) -> dict[str, Any]:
        pr_id = pr_raw["id"]
        logger.info("Extracting data for PR #%d in %s/%s",
                     pr_id, workspace, repo_slug)

        # Diff stat for file changes
        diff_stats = self.get_pr_diff_stat(workspace, repo_slug, pr_id)
        lines_added = sum(d.get("lines_added", 0) for d in diff_stats)
        lines_deleted = sum(d.get("lines_removed", 0) for d in diff_stats)
        changed_files = [
            d.get("new", d.get("old", {})).get("path", "unknown")
            for d in diff_stats
        ]

        # Comments
        comments = self.get_pr_comments(workspace, repo_slug, pr_id)
        comments_count = len(comments)

        # Commits
        commits = self.get_pr_commits(workspace, repo_slug, pr_id)
        commits_count = len(commits)

        # Activity for approvals and tasks
        activity = self.get_pr_activity(workspace, repo_slug, pr_id)
        approvals_count = sum(
            1 for a in activity if a.get("approval") is not None
        )
        tasks_count = sum(
            1 for a in activity if a.get("update", {}).get("changes", {}).get(
                "content") is not None and "task" in str(a).lower()
        )

        # Timestamps
        created_at = pr_raw.get("created_on", "")
        merged_at = pr_raw.get("updated_on", "")
        state = pr_raw.get("state", "")

        # Calculate merge duration in hours
        merge_duration_hours = 0.0
        if created_at and merged_at:
            try:
                created = datetime.fromisoformat(
                    created_at.replace("Z", "+00:00"))
                merged = datetime.fromisoformat(
                    merged_at.replace("Z", "+00:00"))
                merge_duration_hours = (
                    merged - created).total_seconds() / 3600
            except (ValueError, TypeError):
                pass

        author = ""
        author_data = pr_raw.get("author", {})
        if author_data:
            author = author_data.get("display_name",
                                     author_data.get("username", ""))

        return {
            "repo": f"{workspace}/{repo_slug}",
            "pr_id": pr_id,
            "title": pr_raw.get("title", ""),
            "description": pr_raw.get("description", "") or "",
            "author": author,
            "state": state,
            "created_at": created_at,
            "merged_at": merged_at,
            "merge_duration_hours": round(merge_duration_hours, 2),
            "files_changed_count": len(changed_files),
            "lines_added": lines_added,
            "lines_deleted": lines_deleted,
            "commits_count": commits_count,
            "comments_count": comments_count,
            "approvals_count": approvals_count,
            "tasks_count": tasks_count,
            "changed_files": "|".join(changed_files),
        }

    @staticmethod
    def parse_pr_url(pr_url: str) -> tuple[str, str, int]:
        """Parse a Bitbucket PR URL into (workspace, repo_slug, pr_id)."""
        parsed = urlparse(pr_url)
        # Expected: /workspace/repo/pull-requests/123
        parts = [p for p in parsed.path.strip("/").split("/") if p]
        if len(parts) < 4 or parts[2] != "pull-requests":
            raise ValueError(
                f"Invalid Bitbucket PR URL: {pr_url}. "
                "Expected format: https://bitbucket.org/<workspace>/<repo>"
                "/pull-requests/<id>"
            )
        workspace = parts[0]
        repo_slug = parts[1]
        pr_id = int(parts[3])
        return workspace, repo_slug, pr_id
