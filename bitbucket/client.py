import logging
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config.settings import Settings

logger = logging.getLogger(__name__)

_RETRY = Retry(
    total=3,
    backoff_factor=1,          # 1s, 2s, 4s between retries
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET", "POST"],
    raise_on_status=False,
)


def _new_session(username: str, password: str) -> requests.Session:
    s = requests.Session()
    s.auth = (username, password)
    adapter = HTTPAdapter(max_retries=_RETRY)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


class BitbucketClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.bitbucket_base_url.rstrip("/")
        self._username = settings.bitbucket_username
        self._password = settings.bitbucket_app_password

    @property
    def session(self) -> requests.Session:
        """Fresh session per property access avoids stale keep-alive connections."""
        return _new_session(self._username, self._password)

    def _get(self, url: str, params: dict | None = None) -> dict:
        resp = self.session.get(url, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _get_paginated(self, url: str, params: dict | None = None,
                       max_items: int | None = None) -> list[dict]:
        results = []
        params = params or {}
        while url:
            if max_items is not None and len(results) >= max_items:
                break
            data = self._get(url, params)
            values = data.get("values", [])
            results.extend(values)
            url = data.get("next")
            params = {}  # next URL already contains params
        return results if max_items is None else results[:max_items]

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
            (d.get("new") or d.get("old") or {}).get("path", "unknown")
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
            1 for a in activity if ((a.get("update") or {}).get("changes") or {}).get(
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

    def get_branches(self, workspace: str, repo_slug: str,
                     max_branches: int = 200) -> list[str]:
        """Return all branch names for a repository."""
        url = (f"{self.base_url}/repositories/{workspace}/{repo_slug}"
               f"/refs/branches")
        items = self._get_paginated(url, params={"pagelen": 100},
                                    max_items=max_branches)
        return [b["name"] for b in items if b.get("name")]

    def get_default_branch(self, workspace: str, repo_slug: str) -> str:
        """Return the repo's actual default branch (Bitbucket's `mainbranch`),
        e.g. 'master' — never assume it's literally named 'main'."""
        url = f"{self.base_url}/repositories/{workspace}/{repo_slug}"
        info = self._get(url)
        return (info.get("mainbranch") or {}).get("name", "")

    def _get_workspace_slugs(self) -> list[str]:
        """Derive workspace slugs. Explicit BITBUCKET_WORKSPACES takes priority."""
        # 1. Explicit config wins — user knows exactly what they want
        if self.settings.workspaces:
            return list(self.settings.workspaces)

        slugs: set[str] = set()

        # 2. Extract from settings.repositories (e.g. "oslabsdevelopment/drupal-fit-portal")
        for entry in self.settings.repositories:
            parts = entry.strip("/").split("/")
            if len(parts) >= 2:
                slugs.add(parts[0])

        # 3. /user username as last resort
        try:
            user = self._get(f"{self.base_url}/user")
            username = user.get("username", "")
            if username:
                slugs.add(username)
        except Exception:
            pass

        return list(slugs)

    def list_repos_for_workspace(self, workspace: str) -> list[dict]:
        """List all repositories in a workspace, fetching all pages."""
        url = f"{self.base_url}/repositories/{workspace}"
        return self._get_paginated(url, params={"pagelen": 100})

    def list_all_repos(self) -> list[dict]:
        """List repos across all workspaces derived from config and /user."""
        workspace_slugs = self._get_workspace_slugs()
        all_repos: list[dict] = []
        seen_full_names: set[str] = set()
        for slug in workspace_slugs:
            try:
                repos = self.list_repos_for_workspace(slug)
            except Exception as exc:
                logger.warning("Could not list repos for workspace %s: %s", slug, exc)
                continue
            for r in repos:
                full_name = r.get("full_name", "")
                if full_name in seen_full_names:
                    continue
                seen_full_names.add(full_name)
                r["_workspace_slug"] = slug
                all_repos.append(r)
        return all_repos

    def register_webhook(self, workspace: str, repo_slug: str,
                         callback_url: str) -> dict:
        """Register a webhook on a Bitbucket repo for PR created events."""
        url = f"{self.base_url}/repositories/{workspace}/{repo_slug}/hooks"
        payload = {
            "description": "PR Guardian auto-review",
            "url": callback_url,
            "active": True,
            "events": ["pullrequest:created"],
        }
        resp = self.session.post(url, json=payload, timeout=15)
        resp.raise_for_status()
        return resp.json()

    def list_webhooks(self, workspace: str, repo_slug: str) -> list[dict]:
        """List existing webhooks on a repo."""
        url = f"{self.base_url}/repositories/{workspace}/{repo_slug}/hooks"
        return self._get_paginated(url, max_items=50)

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
