import logging
from dataclasses import dataclass, field

from analysis.analyzer import AnalysisReport, PRAnalyzer
from analysis.duplicate_detector import DuplicateDetector
from analysis.graph_reviewer import GraphReviewContext, GraphReviewer
from bitbucket.client import BitbucketClient
from config.settings import Settings
from llm.openai_reviewer import LLMReviewResult, OpenAIReviewer
from security.dependency_scanner import DependencyScanner, ScanResult
from static_analysis.analyzer import StaticAnalysisResult, StaticAnalyzer

logger = logging.getLogger(__name__)


@dataclass
class HybridReport:
    # PR metadata
    pr_id: int = 0
    pr_title: str = ""
    pr_author: str = ""
    repo: str = ""

    # ML + rules (existing)
    risk_level: str = "LOW"
    risk_score: float = 0.0
    ml_reasons: list[str] = field(default_factory=list)
    rule_issues: list[dict] = field(default_factory=list)
    hotspot_files: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)

    # Security scan (new)
    security_warnings: list[dict] = field(default_factory=list)

    # Static analysis (new)
    static_analysis_issues: list[dict] = field(default_factory=list)
    static_tools_run: list[str] = field(default_factory=list)
    static_tools_unavailable: list[str] = field(default_factory=list)

    # LLM analysis (new)
    llm_detected_issues: list[dict] = field(default_factory=list)
    llm_security_concerns: list[dict] = field(default_factory=list)
    llm_performance_concerns: list[dict] = field(default_factory=list)
    llm_code_smells: list[dict] = field(default_factory=list)
    llm_improvements: list[dict] = field(default_factory=list)
    llm_summary: str = ""

    # Duplicate / reuse detection
    duplicate_warnings: list[dict] = field(default_factory=list)

    # Graph / AST context
    graph_context: dict = field(default_factory=dict)

    # Aggregated
    recommendations: list[str] = field(default_factory=list)
    review_focus: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "pr_id": self.pr_id,
            "pr_title": self.pr_title,
            "pr_author": self.pr_author,
            "repo": self.repo,
            "risk_level": self.risk_level,
            "risk_score": self.risk_score,
            "ml_reasons": self.ml_reasons,
            "rule_issues": self.rule_issues,
            "hotspot_files": self.hotspot_files,
            "metrics": self.metrics,
            "security_warnings": self.security_warnings,
            "static_analysis_issues": self.static_analysis_issues,
            "static_tools_run": self.static_tools_run,
            "static_tools_unavailable": self.static_tools_unavailable,
            "llm_detected_issues": self.llm_detected_issues,
            "llm_security_concerns": self.llm_security_concerns,
            "llm_performance_concerns": self.llm_performance_concerns,
            "llm_code_smells": self.llm_code_smells,
            "llm_improvements": self.llm_improvements,
            "llm_summary": self.llm_summary,
            "duplicate_warnings": self.duplicate_warnings,
            "graph_context": self.graph_context,
            "recommendations": self.recommendations,
            "review_focus": self.review_focus,
        }


class HybridReportBuilder:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = BitbucketClient(settings)
        self.analyzer = PRAnalyzer(settings)
        self.dep_scanner = DependencyScanner()
        self.static_analyzer = StaticAnalyzer()
        self.duplicate_detector = DuplicateDetector(settings)
        self.graph_reviewer = GraphReviewer()
        self._llm_reviewer: OpenAIReviewer | None = None

        # Load ML model
        try:
            self.analyzer.load_model()
            logger.info("ML model loaded")
        except FileNotFoundError:
            logger.warning("No trained model — ML predictions unavailable")
        self.analyzer.load_dataset()

        # Init LLM reviewer (provider/key/model resolved from settings)
        try:
            self._llm_reviewer = OpenAIReviewer(settings=settings)
            logger.info("LLM reviewer initialized (provider=%s, model=%s)",
                        settings.llm_provider, settings.resolved_llm_model)
        except ValueError as e:
            logger.warning("LLM reviewer unavailable: %s", e)

    def build_report(self, pr_url: str) -> HybridReport:
        workspace, repo_slug, pr_id = BitbucketClient.parse_pr_url(pr_url)
        repo = f"{workspace}/{repo_slug}"

        # 1) Existing ML + rule analysis
        logger.info("Running ML + rule-based analysis...")
        ml_report: AnalysisReport = self.analyzer.analyze_pr(pr_url)

        # Get PR detail for source branch commit + target branch
        pr_detail = self.client.get_pr_detail(workspace, repo_slug, pr_id)
        source_commit = (
            (pr_detail.get("source") or {}).get("commit") or {}
        ).get("hash", "")
        # The target branch is the ground truth for duplicate + logic analysis.
        # A PR from feature-x→develop must be checked against develop's code;
        # a PR from feature-x→stage must be checked against stage's code.
        target_branch: str = (
            (pr_detail.get("destination") or {}).get("branch") or {}
        ).get("name", "")
        if target_branch:
            logger.info("PR #%d targets branch '%s' — using branch-scoped index",
                        pr_id, target_branch)

        changed_files = (
            ml_report.raw_metrics.get("changed_files_list")
            or self._get_changed_files(workspace, repo_slug, pr_id)
        )

        # 2) Fetch file contents for dependency + static analysis
        logger.info("Fetching file contents for %d changed files...",
                     len(changed_files))
        file_contents = {}
        if source_commit:
            for filepath in changed_files:
                try:
                    content = self.client.get_file_content(
                        workspace, repo_slug, source_commit, filepath
                    )
                    if content:
                        file_contents[filepath] = content
                except Exception:
                    logger.debug("Could not fetch content for %s", filepath)

        # 3) Security dependency scan
        logger.info("Running dependency security scan...")
        scan_result: ScanResult = self.dep_scanner.scan_changed_files(
            changed_files, file_contents
        )

        # 4) Static analysis
        logger.info("Running static analysis...")
        static_result: StaticAnalysisResult = (
            self.static_analyzer.analyze_files(changed_files, file_contents)
        )

        # 5) Graph / AST analysis
        logger.info("Running graph analysis...")
        graph_ctx = GraphReviewContext()
        try:
            graph_ctx = self.graph_reviewer.analyze(
                workspace, repo_slug, changed_files, file_contents,
                target_branch=target_branch,
            )
        except Exception:
            logger.exception("Graph analysis failed")

        # 6) LLM code review (inject graph context into prompt)
        llm_result = LLMReviewResult()
        if self._llm_reviewer:
            logger.info("Running LLM code review...")
            try:
                diff_text = self.client.get_pr_diff(
                    workspace, repo_slug, pr_id
                )
                graph_llm_context = graph_ctx.to_llm_context()
                llm_result = self._llm_reviewer.review_diff(
                    diff_text,
                    pr_title=ml_report.pr_title,
                    pr_description=pr_detail.get("description", "") or "",
                    extra_context=graph_llm_context,
                )
            except Exception:
                logger.exception("LLM review failed")
                llm_result = LLMReviewResult(
                    summary="LLM analysis failed."
                )
        else:
            llm_result = LLMReviewResult(
                summary="LLM reviewer not configured (OPENAI_API_KEY missing)."
            )

        # 7) Duplicate / reuse detection
        logger.info("Running duplicate detection...")
        duplicate_warnings = []
        try:
            duplicate_warnings = self.duplicate_detector.detect(
                workspace, repo_slug, file_contents,
                target_branch=target_branch,
            )
        except Exception:
            logger.exception("Duplicate detection failed")

        # 8) Build hybrid report
        report = self._assemble(
            ml_report, scan_result, static_result, llm_result,
            duplicate_warnings, graph_ctx
        )
        return report

    def _get_changed_files(self, workspace: str, repo_slug: str,
                           pr_id: int) -> list[str]:
        diff_stats = self.client.get_pr_diff_stat(
            workspace, repo_slug, pr_id
        )
        return [
            (d.get("new") or d.get("old") or {}).get("path", "unknown")
            for d in diff_stats
        ]

    def _assemble(self, ml: AnalysisReport, sec: ScanResult,
                  static: StaticAnalysisResult,
                  llm: LLMReviewResult,
                  duplicate_warnings: list | None = None,
                  graph_ctx: GraphReviewContext | None = None) -> HybridReport:
        # Start with ML data
        report = HybridReport(
            pr_id=ml.pr_id,
            pr_title=ml.pr_title,
            pr_author=ml.pr_author,
            repo=ml.repo,
            risk_level=ml.risk_level,
            risk_score=ml.risk_score,
            ml_reasons=ml.reasons,
            rule_issues=ml.detected_issues,
            hotspot_files=ml.hotspot_files,
            metrics=ml.raw_metrics,
        )

        # Security warnings
        report.security_warnings = [
            v.to_dict() for v in sec.vulnerabilities
        ]

        # Static analysis
        report.static_analysis_issues = [
            i.to_dict() for i in static.issues
        ]
        report.static_tools_run = static.tools_run
        report.static_tools_unavailable = static.tools_unavailable

        # LLM results
        report.llm_detected_issues = llm.issues
        report.llm_security_concerns = llm.security_concerns
        report.llm_performance_concerns = llm.performance_concerns
        report.llm_code_smells = llm.code_smells
        report.llm_improvements = llm.suggested_improvements
        report.llm_summary = llm.summary

        # Duplicate / reuse warnings
        report.duplicate_warnings = [
            w.to_dict() for w in (duplicate_warnings or [])
        ]

        # Graph context
        if graph_ctx:
            report.graph_context = graph_ctx.to_dict()

        # Boost risk score based on new findings
        boost = graph_ctx.risk_score_boost if graph_ctx else 0.0
        if sec.vulnerabilities:
            critical = sum(
                1 for v in sec.vulnerabilities
                if v.severity in ("CRITICAL", "HIGH")
            )
            boost += critical * 0.1 + (len(sec.vulnerabilities) - critical) * 0.03

        static_errors = sum(
            1 for i in static.issues if i.severity == "error"
        )
        boost += static_errors * 0.02

        llm_high = sum(
            1 for i in llm.issues
            if isinstance(i, dict) and i.get("severity") == "high"
        )
        llm_sec = len(llm.security_concerns)
        boost += llm_high * 0.05 + llm_sec * 0.08

        new_score = min(1.0, report.risk_score + boost)
        report.risk_score = round(new_score, 3)

        # Recalculate risk level
        if new_score >= self.settings.risk_high_threshold:
            report.risk_level = "HIGH"
        elif new_score >= self.settings.risk_medium_threshold:
            report.risk_level = "MEDIUM"
        else:
            report.risk_level = "LOW"

        # Build recommendations
        recommendations = list(ml.review_focus)

        if sec.vulnerabilities:
            recommendations.append(
                f"Fix {len(sec.vulnerabilities)} vulnerable "
                "dependency(ies) before merging"
            )
        if static_errors > 0:
            recommendations.append(
                f"Resolve {static_errors} static analysis error(s)"
            )
        if llm.security_concerns:
            recommendations.append(
                "Address LLM-flagged security concerns"
            )
        if llm.performance_concerns:
            recommendations.append(
                "Review LLM-flagged performance issues"
            )
        if duplicate_warnings:
            recommendations.append(
                f"Review {len(duplicate_warnings)} potential code reuse "
                "opportunity(ies) — similar code already exists in the repo"
            )
        report.recommendations = recommendations

        # Review focus
        review_focus = list(ml.review_focus)
        if llm.issues:
            review_focus.append(
                f"LLM detected {len(llm.issues)} potential issue(s)"
            )
        if sec.vulnerabilities:
            review_focus.append("Dependency vulnerabilities need attention")
        if duplicate_warnings:
            review_focus.append(
                f"{len(duplicate_warnings)} chunk(s) may duplicate existing code"
            )
        if graph_ctx and graph_ctx.available:
            if graph_ctx.affected_flows:
                review_focus.append(
                    f"Graph: {len(graph_ctx.affected_flows)} execution flow(s) affected"
                )
            if graph_ctx.affected_communities:
                review_focus.append(
                    f"Graph: modules affected — "
                    + ", ".join(graph_ctx.affected_communities[:3])
                )
            if graph_ctx.risk_score_boost > 0:
                recommendations.append(
                    f"Graph analysis flagged critical execution flows "
                    f"(risk boost +{graph_ctx.risk_score_boost:.2f})"
                )
        report.review_focus = review_focus

        return report
