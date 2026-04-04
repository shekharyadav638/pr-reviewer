import json
import logging
from dataclasses import asdict, dataclass, field

import pandas as pd

from bitbucket.client import BitbucketClient
from config.settings import Settings
from features.engineering import FeatureEngineer
from models.trainer import ModelTrainer
from rules.engine import Issue, RuleEngine
from rules.hotspot import HotspotDetector

logger = logging.getLogger(__name__)


@dataclass
class AnalysisReport:
    pr_id: int
    pr_title: str
    pr_author: str
    repo: str
    risk_level: str  # "HIGH", "MEDIUM", "LOW"
    risk_score: float
    reasons: list[str] = field(default_factory=list)
    problematic_files: list[str] = field(default_factory=list)
    detected_issues: list[dict] = field(default_factory=list)
    hotspot_files: list[str] = field(default_factory=list)
    review_focus: list[str] = field(default_factory=list)
    raw_metrics: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)

    def to_text(self) -> str:
        sep = "=" * 60
        lines = [
            sep,
            "  PR GUARDIAN — Analysis Report",
            sep,
            f"  Repository : {self.repo}",
            f"  PR         : #{self.pr_id} — {self.pr_title}",
            f"  Author     : {self.pr_author}",
            sep,
            "",
            f"  RISK LEVEL : {self.risk_level}",
            f"  RISK SCORE : {self.risk_score:.2f}",
            "",
        ]

        if self.reasons:
            lines.append("  REASONS:")
            for r in self.reasons:
                lines.append(f"    - {r}")
            lines.append("")

        if self.detected_issues:
            lines.append("  DETECTED ISSUES:")
            for issue in self.detected_issues:
                sev = issue.get("severity", "?").upper()
                lines.append(f"    [{sev}] {issue['category']}: "
                             f"{issue['description']}")
                for f in issue.get("files", []):
                    lines.append(f"          -> {f}")
            lines.append("")

        if self.problematic_files:
            lines.append("  PROBLEMATIC FILES:")
            for f in self.problematic_files:
                lines.append(f"    - {f}")
            lines.append("")

        if self.hotspot_files:
            lines.append("  HOTSPOT FILES (historically risky):")
            for f in self.hotspot_files:
                lines.append(f"    ! {f}")
            lines.append("")

        if self.review_focus:
            lines.append("  RECOMMENDED REVIEW FOCUS:")
            for f in self.review_focus:
                lines.append(f"    >> {f}")
            lines.append("")

        if self.raw_metrics:
            lines.append("  METRICS:")
            for k, v in self.raw_metrics.items():
                lines.append(f"    {k}: {v}")
            lines.append("")

        lines.append(sep)
        return "\n".join(lines)


class PRAnalyzer:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = BitbucketClient(settings)
        self.rule_engine = RuleEngine()
        self.hotspot_detector = HotspotDetector()

        self.model: ModelTrainer | None = None
        self.feature_engineer: FeatureEngineer | None = None
        self._dataset: pd.DataFrame | None = None

    def load_model(self) -> None:
        model_dir = self.settings.model_output_dir
        self.model = ModelTrainer.load(model_dir)
        self.feature_engineer = FeatureEngineer.load(model_dir)
        logger.info("Model and feature artifacts loaded")

    def load_dataset(self) -> None:
        from dataset.builder import DatasetBuilder
        builder = DatasetBuilder(self.settings)
        try:
            self._dataset = builder.load()
        except FileNotFoundError:
            logger.warning("No training dataset found — hotspot detection "
                           "will be unavailable")
            self._dataset = None

    def analyze_pr(self, pr_url: str) -> AnalysisReport:
        workspace, repo_slug, pr_id = BitbucketClient.parse_pr_url(pr_url)
        repo = f"{workspace}/{repo_slug}"

        # Fetch PR data
        pr_raw = self.client.get_pr_detail(workspace, repo_slug, pr_id)
        pr_data = self.client.extract_pr_data(workspace, repo_slug, pr_raw)

        changed_files = pr_data["changed_files"].split("|") if pr_data[
            "changed_files"] else []

        # ML prediction
        risk_score = 0.5
        ml_reasons = []
        if self.model and self.feature_engineer:
            df_single = pd.DataFrame([pr_data])
            X = self.feature_engineer.transform(df_single)
            proba = self.model.predict_proba(X)[0]
            # proba[:, 1] is probability of needs_major_changes=1
            risk_score = float(proba[1]) if len(proba) > 1 else float(
                proba[0])
            if risk_score >= self.settings.risk_high_threshold:
                ml_reasons.append(
                    f"ML model predicts high risk (score: {risk_score:.2f})")
            elif risk_score >= self.settings.risk_medium_threshold:
                ml_reasons.append(
                    f"ML model predicts medium risk (score: {risk_score:.2f})")

        # Rule-based analysis
        issues = self.rule_engine.analyze(
            changed_files,
            lines_added=pr_data["lines_added"],
            lines_deleted=pr_data["lines_deleted"],
        )

        # Boost risk score based on rule issues
        high_issues = sum(1 for i in issues if i.severity == "high")
        medium_issues = sum(1 for i in issues if i.severity == "medium")
        rule_boost = high_issues * 0.15 + medium_issues * 0.05
        risk_score = min(1.0, risk_score + rule_boost)

        # Determine risk level
        if risk_score >= self.settings.risk_high_threshold:
            risk_level = "HIGH"
        elif risk_score >= self.settings.risk_medium_threshold:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        # Build reasons
        reasons = list(ml_reasons)
        for issue in issues:
            reasons.append(f"[{issue.severity.upper()}] {issue.category}")

        if pr_data["comments_count"] >= self.settings.label_high_comment_threshold:
            reasons.append(
                f"High comment count ({pr_data['comments_count']})")
        if pr_data["commits_count"] >= self.settings.label_many_commits_threshold:
            reasons.append(
                f"Many commits ({pr_data['commits_count']}) — possible rework")

        # Problematic files
        problematic = set()
        for issue in issues:
            problematic.update(issue.files)

        # Hotspot check
        hotspot_files = []
        if self._dataset is not None and not self._dataset.empty:
            hotspots = self.hotspot_detector.detect(self._dataset)
            hotspot_paths = {h["file"] for h in hotspots}
            hotspot_files = [f for f in changed_files if f in hotspot_paths]
            if hotspot_files:
                reasons.append(
                    f"{len(hotspot_files)} file(s) are historical hotspots")

        # Review focus
        review_focus = []
        if problematic:
            review_focus.append(
                "Focus on files flagged by issue detection")
        if hotspot_files:
            review_focus.append(
                "Pay extra attention to historical hotspot files")
        high_sev = [i for i in issues if i.severity == "high"]
        if high_sev:
            cats = set(i.category for i in high_sev)
            review_focus.append(
                f"Critical areas: {', '.join(cats)}")
        if pr_data["lines_added"] + pr_data["lines_deleted"] > 300:
            review_focus.append(
                "Large diff — consider reviewing in stages")

        return AnalysisReport(
            pr_id=pr_id,
            pr_title=pr_data["title"],
            pr_author=pr_data["author"],
            repo=repo,
            risk_level=risk_level,
            risk_score=round(risk_score, 3),
            reasons=reasons,
            problematic_files=sorted(problematic),
            detected_issues=[
                {
                    "category": i.category,
                    "severity": i.severity,
                    "description": i.description,
                    "files": i.files,
                }
                for i in issues
            ],
            hotspot_files=hotspot_files,
            review_focus=review_focus,
            raw_metrics={
                "files_changed": pr_data["files_changed_count"],
                "lines_added": pr_data["lines_added"],
                "lines_deleted": pr_data["lines_deleted"],
                "commits": pr_data["commits_count"],
                "comments": pr_data["comments_count"],
                "approvals": pr_data["approvals_count"],
            },
        )

    def record_feedback(self, pr_url: str, user_corrected_risk: int) -> dict:
        import os
        workspace, repo_slug, pr_id = BitbucketClient.parse_pr_url(pr_url)
        pr_raw = self.client.get_pr_detail(workspace, repo_slug, pr_id)
        pr_data = self.client.extract_pr_data(workspace, repo_slug, pr_raw)
        
        pr_data["pr_url"] = pr_url
        pr_data["user_corrected_risk"] = user_corrected_risk
        
        # Save to feedback.csv
        feedback_dir = self.settings.data_output_dir
        os.makedirs(feedback_dir, exist_ok=True)
        feedback_path = os.path.join(feedback_dir, "feedback.csv")
        
        df = pd.DataFrame([pr_data])
        if not os.path.exists(feedback_path):
            df.to_csv(feedback_path, index=False)
        else:
            df.to_csv(feedback_path, mode='a', header=False, index=False)
            
        logger.info(f"Recorded feedback for {pr_url}: risk={user_corrected_risk}")
        return {"status": "success", "pr_url": pr_url, "user_corrected_risk": user_corrected_risk}
