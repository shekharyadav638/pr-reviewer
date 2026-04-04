import logging

import pandas as pd

from config.settings import Settings

logger = logging.getLogger(__name__)


class Labeler:
    def __init__(self, settings: Settings):
        self.settings = settings

    def generate_labels(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        df["needs_major_changes"] = 0

        # Rule 1: High comment count
        mask_comments = (
            df["comments_count"] >= self.settings.label_high_comment_threshold
        )
        df.loc[mask_comments, "needs_major_changes"] = 1

        # Rule 2: Many commits (suggests rework after review)
        mask_commits = (
            df["commits_count"] >= self.settings.label_many_commits_threshold
        )
        df.loc[mask_commits, "needs_major_changes"] = 1

        # Rule 3: Long time to merge
        mask_merge_time = (
            df["merge_duration_hours"] >= self.settings.label_long_merge_hours
        )
        df.loc[mask_merge_time, "needs_major_changes"] = 1

        # Rule 4: PR declined
        mask_declined = df["state"].str.upper() == "DECLINED"
        df.loc[mask_declined, "needs_major_changes"] = 1

        positive = df["needs_major_changes"].sum()
        total = len(df)
        logger.info(
            "Label distribution: %d/%d positive (%.1f%%)",
            positive, total, (positive / total * 100) if total else 0,
        )
        return df
