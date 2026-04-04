import logging
from collections import Counter

import pandas as pd

logger = logging.getLogger(__name__)


class HotspotDetector:
    def detect(self, df: pd.DataFrame,
               top_n: int = 10) -> list[dict[str, any]]:
        """Identify files frequently involved in high-risk PRs."""
        risky_prs = df[df["needs_major_changes"] == 1]
        if risky_prs.empty:
            logger.info("No high-risk PRs found for hotspot analysis")
            return []

        file_counter = Counter()
        for _, row in risky_prs.iterrows():
            files_str = str(row.get("changed_files", ""))
            if files_str and files_str != "nan":
                files = files_str.split("|")
                file_counter.update(files)

        total_risky = len(risky_prs)
        hotspots = []
        for filepath, count in file_counter.most_common(top_n):
            if not filepath or filepath == "unknown":
                continue
            hotspots.append({
                "file": filepath,
                "risk_pr_count": count,
                "risk_pr_percentage": round(count / total_risky * 100, 1),
            })

        logger.info("Found %d hotspot files", len(hotspots))
        return hotspots
