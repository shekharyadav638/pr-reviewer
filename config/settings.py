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

    openai_api_key: str = ""       # legacy alias — used if LLM_API_KEY not set
    openai_model: str = "gpt-4.1"  # legacy alias — used if LLM_MODEL not set

    # ── LLM provider (chat/review) ─────────────────────────────
    # LLM_PROVIDER:  openai | openrouter | ollama | custom
    # LLM_BASE_URL:  override API base (e.g. https://openrouter.ai/api/v1)
    # LLM_API_KEY:   API key for the chosen provider
    # LLM_MODEL:     model name (e.g. openai/gpt-4o, mistral/mistral-7b)
    llm_provider: str = "openai"
    llm_base_url: str = ""          # empty = provider default
    llm_api_key: str = ""           # empty = falls back to openai_api_key
    llm_model: str = ""             # empty = falls back to openai_model

    # ── Embedding provider (repo indexing) ─────────────────────
    # EMBEDDING_PROVIDER: openai | openrouter | ollama | custom
    # EMBEDDING_BASE_URL: override base URL for embeddings
    # EMBEDDING_API_KEY:  key for embedding provider
    # EMBEDDING_MODEL:    e.g. text-embedding-3-small, nomic-embed-text
    embedding_provider: str = "openai"
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"

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
            # .strip() on secrets — a stray trailing newline/space from a
            # copy-pasted .env value turns into a malformed Authorization
            # header that providers reject as "missing", not "invalid".
            openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
            openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1"),
            # LLM provider
            llm_provider=os.getenv("LLM_PROVIDER", "openai"),
            llm_base_url=os.getenv("LLM_BASE_URL", "").strip(),
            llm_api_key=os.getenv("LLM_API_KEY", "").strip(),
            llm_model=os.getenv("LLM_MODEL", ""),
            # Embedding provider
            embedding_provider=os.getenv("EMBEDDING_PROVIDER", "openai"),
            embedding_base_url=os.getenv("EMBEDDING_BASE_URL", "").strip(),
            embedding_api_key=os.getenv("EMBEDDING_API_KEY", "").strip(),
            embedding_model=os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
        )

    @property
    def resolved_llm_api_key(self) -> str:
        """LLM_API_KEY takes priority; falls back to OPENAI_API_KEY."""
        return self.llm_api_key or self.openai_api_key

    @property
    def resolved_llm_model(self) -> str:
        """LLM_MODEL takes priority; falls back to OPENAI_MODEL."""
        return self.llm_model or self.openai_model

    @property
    def resolved_embedding_api_key(self) -> str:
        """EMBEDDING_API_KEY takes priority; falls back to OPENAI_API_KEY."""
        return self.embedding_api_key or self.openai_api_key

    @property
    def resolved_llm_base_url(self) -> str | None:
        """Return explicit base URL, or well-known defaults per provider."""
        if self.llm_base_url:
            return self.llm_base_url
        defaults = {
            "openrouter": "https://openrouter.ai/api/v1",
            "ollama":     "http://localhost:11434/v1",
        }
        return defaults.get(self.llm_provider)  # None = use SDK default

    @property
    def resolved_embedding_base_url(self) -> str | None:
        """Return explicit embedding base URL, or well-known defaults."""
        if self.embedding_base_url:
            return self.embedding_base_url
        defaults = {
            "openrouter": "https://openrouter.ai/api/v1",
            "ollama":     "http://localhost:11434/v1",
        }
        return defaults.get(self.embedding_provider)
