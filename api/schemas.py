from pydantic import BaseModel, field_validator


class AnalyzeRequest(BaseModel):
    pr_url: str

    @field_validator("pr_url")
    @classmethod
    def validate_pr_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("pr_url must not be empty")
        if "bitbucket.org" not in v or "pull-requests" not in v:
            raise ValueError(
                "Invalid Bitbucket PR URL. "
                "Expected format: https://bitbucket.org/<workspace>/<repo>/pull-requests/<id>"
            )
        return v


class FeedbackRequest(BaseModel):
    pr_url: str
    user_corrected_risk: int  # 1 for High Risk, 0 for Low Risk

    @field_validator("pr_url")
    @classmethod
    def validate_pr_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("pr_url must not be empty")
        if "bitbucket.org" not in v or "pull-requests" not in v:
            raise ValueError(
                "Invalid Bitbucket PR URL. "
                "Expected format: https://bitbucket.org/<workspace>/<repo>/pull-requests/<id>"
            )
        return v

class DetectedIssue(BaseModel):
    category: str
    severity: str
    description: str
    files: list[str] = []


class RawMetrics(BaseModel):
    files_changed: int = 0
    lines_added: int = 0
    lines_deleted: int = 0
    commits: int = 0
    comments: int = 0
    approvals: int = 0


class AnalyzeResponse(BaseModel):
    pr_id: int
    pr_title: str
    pr_author: str
    repo: str
    risk_level: str
    risk_score: float
    reasons: list[str] = []
    problematic_files: list[str] = []
    detected_issues: list[DetectedIssue] = []
    hotspot_files: list[str] = []
    recommendations: list[str] = []
    metrics: RawMetrics = RawMetrics()


class ErrorResponse(BaseModel):
    detail: str


# --- Hybrid analysis schemas ---

class VulnerabilityItem(BaseModel):
    package: str = ""
    version: str = ""
    ecosystem: str = ""
    vuln_id: str = ""
    summary: str = ""
    severity: str = ""
    fixed_version: str = ""


class StaticAnalysisIssueItem(BaseModel):
    file: str = ""
    line: int = 0
    column: int = 0
    severity: str = ""
    rule: str = ""
    message: str = ""
    tool: str = ""


class LLMIssueItem(BaseModel):
    file: str = ""
    severity: str = ""
    description: str = ""


class LLMImprovementItem(BaseModel):
    file: str = ""
    description: str = ""


class DuplicateWarningItem(BaseModel):
    new_chunk_name: str = ""
    new_chunk_kind: str = ""
    new_filepath: str = ""
    existing_name: str = ""
    existing_filepath: str = ""
    existing_language: str = ""
    similarity: float = 0.0
    existing_code_snippet: str = ""


class HybridAnalyzeResponse(BaseModel):
    pr_id: int
    pr_title: str
    pr_author: str
    repo: str

    risk_level: str
    risk_score: float

    ml_reasons: list[str] = []
    rule_issues: list[DetectedIssue] = []
    hotspot_files: list[str] = []
    metrics: RawMetrics = RawMetrics()

    security_warnings: list[VulnerabilityItem] = []

    static_analysis_issues: list[StaticAnalysisIssueItem] = []
    static_tools_run: list[str] = []
    static_tools_unavailable: list[str] = []

    llm_detected_issues: list[LLMIssueItem] = []
    llm_security_concerns: list[LLMIssueItem] = []
    llm_performance_concerns: list[LLMIssueItem] = []
    llm_code_smells: list[LLMIssueItem] = []
    llm_improvements: list[LLMImprovementItem] = []
    llm_summary: str = ""

    duplicate_warnings: list[DuplicateWarningItem] = []
    graph_context: dict = {}

    recommendations: list[str] = []
    review_focus: list[str] = []


# --- Repo management schemas ---

class IndexRepoRequest(BaseModel):
    branch: str = ""


class AddRepoRequest(BaseModel):
    repo_url: str   # e.g. https://bitbucket.org/workspace/repo  OR  workspace/repo

    @field_validator("repo_url")
    @classmethod
    def validate_repo_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("repo_url must not be empty")
        return v


class RepoResponse(BaseModel):
    id: int
    workspace: str
    repo_slug: str
    display_name: str
    git_url: str = ""
    default_branch: str = "main"
    added_at: str

    # Clone
    clone_status: str = "pending"
    clone_progress: int = 0
    clone_error: str = ""
    clone_size_mb: float = 0
    cloned_at: str | None = None

    # AST Graph
    graph_status: str = "pending"
    graph_progress: int = 0
    graph_error: str = ""
    graph_nodes: int = 0
    graph_built_at: str | None = None

    # ChromaDB
    index_status: str = "pending"
    index_progress: int = 0
    index_error: str = ""
    indexed_at: str | None = None

    # PR fetch
    pr_fetch_status: str = "pending"
    pr_count: int = 0
    pr_fetch_error: str = ""

    # Multi-branch
    branches: list[str] = []          # all known branches from Bitbucket
    indexed_branches: list[str] = []  # branches with a completed index
    current_branch: str = ""          # branch being processed right now
    total_branches: int = 0           # total branches in the current run


class PRListItem(BaseModel):
    pr_id: int
    title: str
    author: str
    state: str
    created_at: str
    updated_at: str
    pr_url: str


class SourceEntry(BaseModel):
    name: str
    path: str
    type: str   # "file" | "dir"
    size: int = 0


class SourceFileResponse(BaseModel):
    path: str
    content: str


class PostReviewCommentsRequest(BaseModel):
    llm_detected_issues: list[dict] = []
    llm_security_concerns: list[dict] = []
    llm_performance_concerns: list[dict] = []
    llm_code_smells: list[dict] = []
    llm_improvements: list[dict] = []
    static_analysis_issues: list[dict] = []


class GraphContextItem(BaseModel):
    affected_functions: list[dict] = []
    affected_flows: list[dict] = []
    risk_score_boost: float = 0.0
    impact_summary: str = ""
    graph_duplicates: list[dict] = []
    affected_communities: list[str] = []
