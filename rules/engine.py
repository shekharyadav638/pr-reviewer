import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

SENSITIVE_DIRECTORIES = [
    "auth/", "auth\\",
    "payment/", "payment\\",
    "config/", "config\\",
    "database/", "database\\",
    "middleware/", "middleware\\",
    "security/", "security\\",
    "migrations/", "migrations\\",
]

DEPENDENCY_FILES = [
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "requirements.txt",
    "Pipfile",
    "Pipfile.lock",
    "poetry.lock",
    "pyproject.toml",
    "pom.xml",
    "build.gradle",
    "go.mod",
    "go.sum",
    "Gemfile",
    "Gemfile.lock",
    "Cargo.toml",
    "Cargo.lock",
]

TEST_PATTERNS = [
    "test_", "_test.", ".test.", ".spec.", "tests/", "test/",
    "__tests__/", "spec/",
]

BACKEND_EXTENSIONS = [
    ".py", ".java", ".go", ".rs", ".rb", ".php", ".cs",
    ".js", ".ts",
]

LARGE_PR_FILES_THRESHOLD = 15
LARGE_PR_LINES_THRESHOLD = 500


@dataclass
class Issue:
    category: str
    severity: str  # "high", "medium", "low"
    description: str
    files: list[str] = field(default_factory=list)


class RuleEngine:
    def analyze(self, changed_files: list[str],
                lines_added: int = 0,
                lines_deleted: int = 0) -> list[Issue]:
        issues = []
        issues.extend(self._check_missing_tests(changed_files))
        issues.extend(self._check_sensitive_modules(changed_files))
        issues.extend(self._check_dependency_changes(changed_files))
        issues.extend(self._check_large_change(
            changed_files, lines_added, lines_deleted))
        return issues

    def _check_missing_tests(self, files: list[str]) -> list[Issue]:
        backend_files = [
            f for f in files
            if any(f.endswith(ext) for ext in BACKEND_EXTENSIONS)
            and not any(pat in f.lower() for pat in TEST_PATTERNS)
        ]
        test_files = [
            f for f in files
            if any(pat in f.lower() for pat in TEST_PATTERNS)
        ]

        if backend_files and not test_files:
            return [Issue(
                category="Missing Tests",
                severity="high",
                description=(
                    f"{len(backend_files)} backend file(s) changed "
                    "but no test files were modified."
                ),
                files=backend_files,
            )]
        return []

    def _check_sensitive_modules(self, files: list[str]) -> list[Issue]:
        sensitive_files = [
            f for f in files
            if any(sd in f.lower() for sd in SENSITIVE_DIRECTORIES)
        ]
        if sensitive_files:
            return [Issue(
                category="Sensitive Module Changes",
                severity="high",
                description=(
                    f"{len(sensitive_files)} file(s) in sensitive modules "
                    "(auth, payment, config, database, middleware) were changed."
                ),
                files=sensitive_files,
            )]
        return []

    def _check_dependency_changes(self, files: list[str]) -> list[Issue]:
        dep_files = [
            f for f in files
            if any(f.endswith(dep) or f.split("/")[-1] == dep
                   for dep in DEPENDENCY_FILES)
        ]
        if dep_files:
            return [Issue(
                category="Dependency Changes",
                severity="medium",
                description=(
                    f"{len(dep_files)} dependency file(s) modified. "
                    "Review for supply chain or compatibility risks."
                ),
                files=dep_files,
            )]
        return []

    def _check_large_change(self, files: list[str],
                            lines_added: int,
                            lines_deleted: int) -> list[Issue]:
        issues = []
        total_lines = lines_added + lines_deleted
        if len(files) > LARGE_PR_FILES_THRESHOLD:
            issues.append(Issue(
                category="Large Change — Many Files",
                severity="medium",
                description=(
                    f"PR touches {len(files)} files "
                    f"(threshold: {LARGE_PR_FILES_THRESHOLD}). "
                    "Consider splitting into smaller PRs."
                ),
            ))
        if total_lines > LARGE_PR_LINES_THRESHOLD:
            issues.append(Issue(
                category="Large Change — Many Lines",
                severity="medium",
                description=(
                    f"PR changes {total_lines} lines "
                    f"(+{lines_added}/-{lines_deleted}, "
                    f"threshold: {LARGE_PR_LINES_THRESHOLD}). "
                    "Consider splitting into smaller PRs."
                ),
            ))
        return issues
