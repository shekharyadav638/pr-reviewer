"""
Sparse shallow cloner — works for any git provider (Bitbucket, GitHub, GitLab).

Strategy:
  - depth=1        : no history, ~80% smaller than full clone
  - sparse checkout: skip node_modules, dist, vendor, binaries
  - filter=blob    : skip large binary blobs
  - no-tags        : skip tag objects

Stored at: data/clones/<workspace>_<repo>/
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlparse, urlunparse

logger = logging.getLogger(__name__)

CLONE_BASE = Path("data/clones")

# Directories / patterns to exclude via sparse checkout
SPARSE_EXCLUDE = [
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".next",
    "__pycache__",
    "*.min.js",
    "*.min.css",
    "*.map",
    "*.lock",
    "*.egg-info",
    ".venv",
    "venv",
    "coverage",
    ".nyc_output",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.ico",
    "*.svg",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
    "*.pdf",
    "*.zip",
    "*.tar.gz",
]


def clone_dir(workspace: str, repo_slug: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", f"{workspace}_{repo_slug}")
    return CLONE_BASE / safe


def _inject_credentials(git_url: str, username: str, password: str) -> str:
    """Inject basic-auth credentials into an https:// URL."""
    parsed = urlparse(git_url)
    if parsed.scheme in ("http", "https") and username and password:
        netloc = f"{username}:{password}@{parsed.hostname}"
        if parsed.port:
            netloc += f":{parsed.port}"
        return urlunparse(parsed._replace(netloc=netloc))
    return git_url


def _run(cmd: list[str], cwd: Optional[Path] = None,
         env: Optional[dict] = None) -> str:
    result = subprocess.run(
        cmd, cwd=str(cwd) if cwd else None,
        capture_output=True, text=True,
        env={**os.environ, **(env or {})},
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed: {' '.join(cmd)}\n"
            f"stderr: {result.stderr.strip()}"
        )
    return result.stdout.strip()


class RepoCloner:
    def __init__(self, username: str = "", password: str = "",
                 ssh_key_path: str = ""):
        self.username = username
        self.password = password
        self.ssh_key_path = ssh_key_path

    def _auth_url(self, git_url: str) -> str:
        return _inject_credentials(git_url, self.username, self.password)

    def _git_env(self) -> dict:
        env = {}
        if self.ssh_key_path:
            env["GIT_SSH_COMMAND"] = (
                f"ssh -i {self.ssh_key_path} -o StrictHostKeyChecking=no"
            )
        return env

    def clone(
        self,
        git_url: str,
        workspace: str,
        repo_slug: str,
        branch: str = "",
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> Path:
        """
        Sparse shallow clone of git_url into data/clones/<workspace>_<repo>/.
        Returns the clone path.
        """
        dest = clone_dir(workspace, repo_slug)
        auth_url = self._auth_url(git_url)
        env = self._git_env()

        def _prog(pct: int, msg: str):
            logger.info("[%d%%] %s", pct, msg)
            if progress_callback:
                progress_callback(pct, msg)

        if dest.exists():
            _prog(5, f"Clone already exists at {dest}, pulling latest…")
            self._pull(dest, branch, env, _prog)
            return dest

        dest.parent.mkdir(parents=True, exist_ok=True)
        _prog(2, f"Cloning {git_url} (sparse, depth=1)…")

        # Step 1: sparse init clone (no checkout yet)
        cmd = [
            "git", "clone",
            "--depth", "1",
            "--no-tags",
            "--filter=blob:none",
            "--sparse",
            "--single-branch",
        ]
        if branch:
            cmd += ["--branch", branch]
        cmd += [auth_url, str(dest)]
        _run(cmd, env=env)
        _prog(40, "Clone complete, configuring sparse checkout…")

        # Step 2: sparse-checkout set (include everything except excludes)
        self._apply_sparse(dest)
        _prog(60, "Sparse checkout configured, checking out files…")

        # Step 3: actually checkout the files
        _run(["git", "sparse-checkout", "reapply"], cwd=dest, env=env)
        _prog(80, "Files checked out.")

        # Step 4: strip .git pack objects to save space (keep refs only)
        self._slim_git_dir(dest, env)
        _prog(100, f"Done. Clone at {dest}")

        return dest

    def _apply_sparse(self, dest: Path) -> None:
        """Write sparse-checkout config: include all, exclude heavy dirs."""
        sparse_file = dest / ".git" / "info" / "sparse-checkout"
        sparse_file.parent.mkdir(parents=True, exist_ok=True)
        rules = ["/*\n"]  # include everything by default
        for pattern in SPARSE_EXCLUDE:
            rules.append(f"!/{pattern}\n")
            rules.append(f"!**/{pattern}\n")
        sparse_file.write_text("".join(rules))

        # Enable cone mode off so our patterns work
        _run(
            ["git", "config", "core.sparseCheckout", "true"],
            cwd=dest,
        )

    def _slim_git_dir(self, dest: Path, env: dict) -> None:
        """Remove pack files and repack minimally to save disk space."""
        try:
            _run(["git", "gc", "--aggressive", "--prune=all"], cwd=dest, env=env)
        except Exception:
            pass  # gc is best-effort

    def _pull(self, dest: Path, branch: str, env: dict,
              progress_callback: Callable) -> None:
        """Update an existing clone to latest."""
        progress_callback(10, "Fetching latest changes…")
        try:
            fetch_cmd = ["git", "fetch", "--depth", "1", "--no-tags", "origin"]
            if branch:
                fetch_cmd.append(branch)
            _run(fetch_cmd, cwd=dest, env=env)

            reset_ref = f"origin/{branch}" if branch else "origin/HEAD"
            _run(["git", "reset", "--hard", reset_ref], cwd=dest, env=env)
            progress_callback(100, "Sync complete.")
        except Exception as exc:
            logger.warning("Pull failed: %s", exc)
            progress_callback(100, f"Sync warning: {exc}")

    def sync(
        self,
        workspace: str,
        repo_slug: str,
        branch: str = "",
        git_url: str = "",
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> Path:
        """Pull latest for an already-cloned repo."""
        dest = clone_dir(workspace, repo_slug)
        env = self._git_env()

        def _prog(pct: int, msg: str):
            logger.info("[%d%%] %s", pct, msg)
            if progress_callback:
                progress_callback(pct, msg)

        if not dest.exists():
            if not git_url:
                raise ValueError(f"Repo not cloned yet and no git_url provided")
            return self.clone(git_url, workspace, repo_slug, branch, progress_callback)

        self._pull(dest, branch, env, _prog)
        return dest

    def list_branches(self, workspace: str, repo_slug: str) -> list[str]:
        dest = clone_dir(workspace, repo_slug)
        if not dest.exists():
            return []
        try:
            out = _run(
                ["git", "branch", "-r", "--format=%(refname:short)"],
                cwd=dest,
            )
            branches = []
            for line in out.splitlines():
                b = line.strip().removeprefix("origin/")
                if b and b != "HEAD":
                    branches.append(b)
            return branches
        except Exception:
            return []

    def get_current_branch(self, workspace: str, repo_slug: str) -> str:
        dest = clone_dir(workspace, repo_slug)
        if not dest.exists():
            return ""
        try:
            return _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=dest)
        except Exception:
            return ""

    def checkout_branch(self, workspace: str, repo_slug: str,
                        branch: str) -> None:
        dest = clone_dir(workspace, repo_slug)
        env = self._git_env()
        _run(["git", "fetch", "--depth", "1", "--no-tags",
               "origin", branch], cwd=dest, env=env)
        _run(["git", "checkout", "-B", branch,
               f"origin/{branch}"], cwd=dest, env=env)

    def browse(self, workspace: str, repo_slug: str,
               path: str = "") -> list[dict]:
        """List files/dirs at path inside the clone."""
        dest = clone_dir(workspace, repo_slug)
        target = dest / path if path else dest
        if not target.exists():
            return []
        items = []
        for entry in sorted(target.iterdir(),
                             key=lambda e: (e.is_file(), e.name.lower())):
            if entry.name == ".git":
                continue
            stat = entry.stat()
            items.append({
                "name": entry.name,
                "path": str(entry.relative_to(dest)),
                "type": "file" if entry.is_file() else "dir",
                "size": stat.st_size if entry.is_file() else 0,
            })
        return items

    def read_file(self, workspace: str, repo_slug: str,
                  path: str) -> str:
        """Read a source file from the clone."""
        dest = clone_dir(workspace, repo_slug)
        target = dest / path
        if not target.exists() or not target.is_file():
            raise FileNotFoundError(f"{path} not found in clone")
        # Only read text files up to 2MB
        if target.stat().st_size > 2 * 1024 * 1024:
            return "# File too large to display (>2MB)"
        try:
            return target.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            raise IOError(f"Cannot read {path}: {e}")

    def disk_usage_mb(self, workspace: str, repo_slug: str) -> float:
        dest = clone_dir(workspace, repo_slug)
        if not dest.exists():
            return 0.0
        total = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file())
        return round(total / (1024 * 1024), 2)

    def delete_clone(self, workspace: str, repo_slug: str) -> None:
        import shutil
        dest = clone_dir(workspace, repo_slug)
        if dest.exists():
            shutil.rmtree(dest)
            logger.info("Deleted clone at %s", dest)
