import logging
from typing import Any

from bitbucket.client import BitbucketClient
from config.settings import Settings

logger = logging.getLogger(__name__)


class DataCollector:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = BitbucketClient(settings)

    def collect_from_repo(self, workspace: str, repo_slug: str) -> list[dict]:
        all_pr_data = []
        for state in self.settings.pr_state_filter:
            logger.info("Fetching %s PRs from %s/%s...",
                        state, workspace, repo_slug)
            prs = self.client.get_pull_requests(
                workspace, repo_slug,
                state=state,
                limit=self.settings.pr_fetch_limit,
            )
            logger.info("Found %d %s PRs", len(prs), state)

            for pr_raw in prs:
                try:
                    pr_data = self.client.extract_pr_data(
                        workspace, repo_slug, pr_raw
                    )
                    all_pr_data.append(pr_data)
                except Exception:
                    logger.exception(
                        "Failed to extract PR #%s", pr_raw.get("id", "?")
                    )
        return all_pr_data

    def collect_all(self) -> list[dict[str, Any]]:
        all_data = []
        for repo_path in self.settings.repositories:
            parts = repo_path.strip().split("/")
            if len(parts) != 2:
                logger.warning("Invalid repo format: %s (expected workspace/repo)",
                               repo_path)
                continue
            workspace, repo_slug = parts
            repo_data = self.collect_from_repo(workspace, repo_slug)
            all_data.extend(repo_data)
            logger.info("Collected %d PRs from %s", len(repo_data), repo_path)

        logger.info("Total PRs collected: %d", len(all_data))
        return all_data
