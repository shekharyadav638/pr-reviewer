import os
from dataclasses import dataclass, field
from dotenv import load_dotenv


@dataclass
class Settings:
    bitbucket_username: str = ""
    bitbucket_app_password: str = ""
    bitbucket_base_url: str = "https://api.bitbucket.org/2.0"
    repositories: list[str] = field(default_factory=list)
    workspaces: list[str] = field(default_factory=list)  # explicit workspace slugs

    pr_fetch_limit: int = 100
    pr_state_filter: list[str] = field(default_factory=lambda: ["MERGED", "DECLINED"])

    model_output_dir: str = "models"
    data_output_dir: str = "data/training"

    risk_high_threshold: float = 0.7
    risk_medium_threshold: float = 0.4

    label_high_comment_threshold: int = 5
    label_long_merge_hours: int = 72
    label_many_commits_threshold: int = 10

    openai_api_key: str = ""
    openai_model: str = "gpt-4.1"

    @classmethod
    def load(cls, env_path: str | None = None) -> "Settings":
        load_dotenv(env_path or ".env", override=True)
        repos_raw = os.getenv("BITBUCKET_REPOSITORIES", "")
        repos = [r.strip() for r in repos_raw.split(",") if r.strip()]
        ws_raw = os.getenv("BITBUCKET_WORKSPACES", "")
        workspaces = [w.strip() for w in ws_raw.split(",") if w.strip()]
        states_raw = os.getenv("PR_STATE_FILTER", "MERGED,DECLINED")
        states = [s.strip() for s in states_raw.split(",") if s.strip()]

        return cls(
            bitbucket_username=os.getenv("BITBUCKET_USERNAME", ""),
            bitbucket_app_password=os.getenv("BITBUCKET_APP_PASSWORD", ""),
            bitbucket_base_url=os.getenv(
                "BITBUCKET_BASE_URL", "https://api.bitbucket.org/2.0"
            ),
            repositories=repos,
            workspaces=workspaces,
            pr_fetch_limit=int(os.getenv("PR_FETCH_LIMIT", "100")),
            pr_state_filter=states,
            model_output_dir=os.getenv("MODEL_OUTPUT_DIR", "models"),
            data_output_dir=os.getenv("DATA_OUTPUT_DIR", "data/training"),
            risk_high_threshold=float(os.getenv("RISK_HIGH_THRESHOLD", "0.7")),
            risk_medium_threshold=float(os.getenv("RISK_MEDIUM_THRESHOLD", "0.4")),
            label_high_comment_threshold=int(
                os.getenv("LABEL_HIGH_COMMENT_THRESHOLD", "5")
            ),
            label_long_merge_hours=int(os.getenv("LABEL_LONG_MERGE_HOURS", "72")),
            label_many_commits_threshold=int(
                os.getenv("LABEL_MANY_COMMITS_THRESHOLD", "10")
            ),
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1"),
        )
