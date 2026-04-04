"""Persistent SQLite store for tracked repositories and their state."""

import sqlite3
import threading
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional


DB_PATH = Path("data/repos.db")


@dataclass
class RepoRecord:
    id: int
    workspace: str
    repo_slug: str
    display_name: str
    git_url: str
    default_branch: str
    added_at: str

    # Clone
    clone_status: str       # pending | cloning | cloned | error
    clone_progress: int
    clone_error: str
    clone_size_mb: float
    cloned_at: Optional[str]

    # Graph (AST)
    graph_status: str       # pending | building | built | error
    graph_progress: int
    graph_error: str
    graph_nodes: int
    graph_built_at: Optional[str]

    # ChromaDB vector index
    index_status: str       # pending | indexing | indexed | error
    index_progress: int
    index_error: str
    indexed_at: Optional[str]

    # PR fetch
    pr_fetch_status: str    # pending | fetching | done | error
    pr_count: int
    pr_fetch_error: str

    @property
    def full_name(self) -> str:
        return f"{self.workspace}/{self.repo_slug}"

    def to_dict(self) -> dict:
        return asdict(self)


class RepoStore:
    _lock = threading.Lock()

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS repos (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace        TEXT NOT NULL,
                    repo_slug        TEXT NOT NULL,
                    display_name     TEXT NOT NULL DEFAULT '',
                    git_url          TEXT NOT NULL DEFAULT '',
                    default_branch   TEXT NOT NULL DEFAULT 'main',
                    added_at         TEXT NOT NULL,

                    clone_status     TEXT NOT NULL DEFAULT 'pending',
                    clone_progress   INTEGER NOT NULL DEFAULT 0,
                    clone_error      TEXT NOT NULL DEFAULT '',
                    clone_size_mb    REAL NOT NULL DEFAULT 0,
                    cloned_at        TEXT,

                    graph_status     TEXT NOT NULL DEFAULT 'pending',
                    graph_progress   INTEGER NOT NULL DEFAULT 0,
                    graph_error      TEXT NOT NULL DEFAULT '',
                    graph_nodes      INTEGER NOT NULL DEFAULT 0,
                    graph_built_at   TEXT,

                    index_status     TEXT NOT NULL DEFAULT 'pending',
                    index_progress   INTEGER NOT NULL DEFAULT 0,
                    index_error      TEXT NOT NULL DEFAULT '',
                    indexed_at       TEXT,

                    pr_fetch_status  TEXT NOT NULL DEFAULT 'pending',
                    pr_count         INTEGER NOT NULL DEFAULT 0,
                    pr_fetch_error   TEXT NOT NULL DEFAULT '',

                    UNIQUE(workspace, repo_slug)
                )
            """)
            # Migrate older DBs that lack new columns
            self._migrate(conn)

    def _migrate(self, conn: sqlite3.Connection) -> None:
        existing = {row[1] for row in conn.execute("PRAGMA table_info(repos)")}
        new_cols = {
            "git_url":        "TEXT NOT NULL DEFAULT ''",
            "default_branch": "TEXT NOT NULL DEFAULT 'main'",
            "clone_status":   "TEXT NOT NULL DEFAULT 'pending'",
            "clone_progress": "INTEGER NOT NULL DEFAULT 0",
            "clone_error":    "TEXT NOT NULL DEFAULT ''",
            "clone_size_mb":  "REAL NOT NULL DEFAULT 0",
            "cloned_at":      "TEXT",
            "graph_status":   "TEXT NOT NULL DEFAULT 'pending'",
            "graph_progress": "INTEGER NOT NULL DEFAULT 0",
            "graph_error":    "TEXT NOT NULL DEFAULT ''",
            "graph_nodes":    "INTEGER NOT NULL DEFAULT 0",
            "graph_built_at": "TEXT",
        }
        for col, typedef in new_cols.items():
            if col not in existing:
                conn.execute(f"ALTER TABLE repos ADD COLUMN {col} {typedef}")

    def _row_to_record(self, row: sqlite3.Row) -> RepoRecord:
        d = dict(row)
        return RepoRecord(
            id=d["id"],
            workspace=d["workspace"],
            repo_slug=d["repo_slug"],
            display_name=d["display_name"],
            git_url=d.get("git_url", ""),
            default_branch=d.get("default_branch", "main"),
            added_at=d["added_at"],
            clone_status=d.get("clone_status", "pending"),
            clone_progress=d.get("clone_progress", 0),
            clone_error=d.get("clone_error", ""),
            clone_size_mb=d.get("clone_size_mb", 0.0),
            cloned_at=d.get("cloned_at"),
            graph_status=d.get("graph_status", "pending"),
            graph_progress=d.get("graph_progress", 0),
            graph_error=d.get("graph_error", ""),
            graph_nodes=d.get("graph_nodes", 0),
            graph_built_at=d.get("graph_built_at"),
            index_status=d.get("index_status", "pending"),
            index_progress=d.get("index_progress", 0),
            index_error=d.get("index_error", ""),
            indexed_at=d.get("indexed_at"),
            pr_fetch_status=d.get("pr_fetch_status", "pending"),
            pr_count=d.get("pr_count", 0),
            pr_fetch_error=d.get("pr_fetch_error", ""),
        )

    def add_repo(self, workspace: str, repo_slug: str,
                 display_name: str = "",
                 git_url: str = "",
                 default_branch: str = "main") -> RepoRecord:
        now = datetime.utcnow().isoformat()
        if not display_name:
            display_name = f"{workspace}/{repo_slug}"
        with self._lock, self._conn() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO repos
                   (workspace, repo_slug, display_name, git_url,
                    default_branch, added_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (workspace, repo_slug, display_name,
                 git_url, default_branch, now),
            )
            # Update git_url if it was provided and row already existed
            if git_url:
                conn.execute(
                    "UPDATE repos SET git_url=?, default_branch=? "
                    "WHERE workspace=? AND repo_slug=?",
                    (git_url, default_branch, workspace, repo_slug),
                )
            row = conn.execute(
                "SELECT * FROM repos WHERE workspace=? AND repo_slug=?",
                (workspace, repo_slug),
            ).fetchone()
        return self._row_to_record(row)

    def list_repos(self) -> list[RepoRecord]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM repos ORDER BY added_at DESC"
            ).fetchall()
        return [self._row_to_record(r) for r in rows]

    def get_repo(self, repo_id: int) -> Optional[RepoRecord]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM repos WHERE id=?", (repo_id,)
            ).fetchone()
        return self._row_to_record(row) if row else None

    def get_repo_by_slug(self, workspace: str,
                         repo_slug: str) -> Optional[RepoRecord]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM repos WHERE workspace=? AND repo_slug=?",
                (workspace, repo_slug),
            ).fetchone()
        return self._row_to_record(row) if row else None

    def delete_repo(self, repo_id: int) -> bool:
        with self._lock, self._conn() as conn:
            cursor = conn.execute(
                "DELETE FROM repos WHERE id=?", (repo_id,)
            )
        return cursor.rowcount > 0

    def update_clone_status(self, repo_id: int, status: str,
                            progress: int = 0, error: str = "",
                            size_mb: float = 0,
                            cloned_at: Optional[str] = None) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                """UPDATE repos SET
                   clone_status=?, clone_progress=?, clone_error=?,
                   clone_size_mb=CASE WHEN ? > 0 THEN ? ELSE clone_size_mb END,
                   cloned_at=COALESCE(?, cloned_at)
                   WHERE id=?""",
                (status, progress, error, size_mb, size_mb, cloned_at, repo_id),
            )

    def update_graph_status(self, repo_id: int, status: str,
                            progress: int = 0, error: str = "",
                            nodes: int = 0,
                            built_at: Optional[str] = None) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                """UPDATE repos SET
                   graph_status=?, graph_progress=?, graph_error=?,
                   graph_nodes=CASE WHEN ? > 0 THEN ? ELSE graph_nodes END,
                   graph_built_at=COALESCE(?, graph_built_at)
                   WHERE id=?""",
                (status, progress, error, nodes, nodes, built_at, repo_id),
            )

    def update_index_status(self, repo_id: int, status: str,
                            progress: int = 0, error: str = "",
                            indexed_at: Optional[str] = None) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                """UPDATE repos SET
                   index_status=?, index_progress=?, index_error=?,
                   indexed_at=COALESCE(?, indexed_at)
                   WHERE id=?""",
                (status, progress, error, indexed_at, repo_id),
            )

    def update_pr_fetch_status(self, repo_id: int, status: str,
                               pr_count: int = 0,
                               error: str = "") -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                """UPDATE repos SET
                   pr_fetch_status=?, pr_count=?, pr_fetch_error=?
                   WHERE id=?""",
                (status, pr_count, error, repo_id),
            )

    def update_default_branch(self, repo_id: int, branch: str) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                "UPDATE repos SET default_branch=? WHERE id=?",
                (branch, repo_id),
            )
