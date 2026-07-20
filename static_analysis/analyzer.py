import json
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# File extension to analyzer mapping
ANALYZERS = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "javascript",
    ".tsx": "javascript",
}


@dataclass
class StaticIssue:
    file: str
    line: int
    column: int
    severity: str  # "error", "warning", "info"
    rule: str
    message: str
    tool: str

    def to_dict(self) -> dict:
        return {
            "file": self.file,
            "line": self.line,
            "column": self.column,
            "severity": self.severity,
            "rule": self.rule,
            "message": self.message,
            "tool": self.tool,
        }


@dataclass
class StaticAnalysisResult:
    issues: list[StaticIssue] = field(default_factory=list)
    tools_run: list[str] = field(default_factory=list)
    tools_unavailable: list[str] = field(default_factory=list)
    files_analyzed: int = 0

    def to_dict(self) -> dict:
        return {
            "issues": [i.to_dict() for i in self.issues],
            "tools_run": self.tools_run,
            "tools_unavailable": self.tools_unavailable,
            "files_analyzed": self.files_analyzed,
        }


class StaticAnalyzer:
    def __init__(self):
        # Cached across calls (this instance lives for the process's
        # lifetime via HybridReportBuilder) so we don't re-spawn
        # `eslint --version` on every single PR review.
        self._eslint_major: int | None = None

    def analyze_files(self, changed_files: list[str],
                      file_contents: dict[str, str]) -> StaticAnalysisResult:
        """Run static analysis on changed files.

        Args:
            changed_files: List of changed file paths.
            file_contents: Map of file path -> file content.
        """
        result = StaticAnalysisResult()

        # Group files by analyzer type
        python_files = {}
        js_files = {}

        for filepath in changed_files:
            _, ext = os.path.splitext(filepath)
            analyzer_type = ANALYZERS.get(ext)
            content = file_contents.get(filepath, "")
            if not content:
                continue
            if analyzer_type == "python":
                python_files[filepath] = content
            elif analyzer_type == "javascript":
                js_files[filepath] = content

        if python_files:
            self._run_python_analysis(python_files, result)

        if js_files:
            self._run_js_analysis(js_files, result)

        result.files_analyzed = len(python_files) + len(js_files)
        return result

    def _run_python_analysis(self, files: dict[str, str],
                             result: StaticAnalysisResult) -> None:
        # Try flake8 first, fall back to pylint
        if shutil.which("flake8"):
            self._run_flake8(files, result)
        elif shutil.which("pylint"):
            self._run_pylint(files, result)
        else:
            result.tools_unavailable.append("flake8/pylint")
            logger.warning("Neither flake8 nor pylint found in PATH")

    def _run_js_analysis(self, files: dict[str, str],
                         result: StaticAnalysisResult) -> None:
        if shutil.which("eslint"):
            self._run_eslint(files, result)
        else:
            result.tools_unavailable.append("eslint")
            logger.warning("eslint not found in PATH")

    def _run_flake8(self, files: dict[str, str],
                    result: StaticAnalysisResult) -> None:
        result.tools_run.append("flake8")
        with tempfile.TemporaryDirectory() as tmpdir:
            file_map = self._write_temp_files(files, tmpdir)
            temp_paths = list(file_map.keys())

            try:
                proc = subprocess.run(
                    ["flake8", "--format=json", "--max-line-length=120",
                     *temp_paths],
                    capture_output=True, text=True, timeout=60,
                    cwd=tmpdir,
                )
            except (subprocess.TimeoutExpired, FileNotFoundError):
                logger.warning("flake8 execution failed")
                return

            # flake8 --format=json doesn't exist natively, use default output
            # Parse default format: file:line:col: CODE message
            for line in proc.stdout.splitlines():
                issue = self._parse_flake8_line(line, file_map)
                if issue:
                    result.issues.append(issue)

    def _run_pylint(self, files: dict[str, str],
                    result: StaticAnalysisResult) -> None:
        result.tools_run.append("pylint")
        with tempfile.TemporaryDirectory() as tmpdir:
            file_map = self._write_temp_files(files, tmpdir)
            temp_paths = list(file_map.keys())

            try:
                proc = subprocess.run(
                    ["pylint", "--output-format=json", "--disable=C,R",
                     *temp_paths],
                    capture_output=True, text=True, timeout=60,
                    cwd=tmpdir,
                )
            except (subprocess.TimeoutExpired, FileNotFoundError):
                logger.warning("pylint execution failed")
                return

            try:
                issues_data = json.loads(proc.stdout) if proc.stdout else []
            except json.JSONDecodeError:
                return

            for item in issues_data:
                temp_path = item.get("path", "")
                original_path = file_map.get(
                    temp_path,
                    file_map.get(
                        os.path.join(tmpdir, temp_path), temp_path
                    ),
                )
                severity = "error" if item.get("type") == "error" else "warning"
                result.issues.append(StaticIssue(
                    file=original_path,
                    line=item.get("line") or 0,
                    column=item.get("column") or 0,
                    severity=severity,
                    rule=item.get("message-id") or item.get("symbol") or "",
                    message=item.get("message") or "",
                    tool="pylint",
                ))

    def _get_eslint_major(self) -> int | None:
        if self._eslint_major is not None:
            return self._eslint_major
        try:
            proc = subprocess.run(
                ["eslint", "--version"],
                capture_output=True, text=True, timeout=10,
            )
            self._eslint_major = int(proc.stdout.strip().lstrip("v").split(".")[0])
        except Exception:
            logger.warning("Could not determine eslint version")
            return None
        return self._eslint_major

    @staticmethod
    def _write_eslint_config(tmpdir: str, major: int) -> str:
        """`--no-eslintrc` alone disables project config *without enabling
        any rules* — ESLint has no rules on by default, so every run
        silently reports zero findings regardless of code quality. Write an
        explicit baseline config instead, so linting actually has a
        ruleset to check against.

        ESLint 9+ dropped eslintrc entirely for flat config, and
        `eslint:recommended` there requires the separate `@eslint/js`
        package (not guaranteed present on a bare `npm install -g eslint`)
        — so the flat-config path hand-enables core rules directly instead
        of depending on that package.
        """
        if major >= 9:
            # `globals` must be listed explicitly (no `env` shorthand in flat
            # config) — otherwise no-undef flags console/window/process/etc.
            # as undefined on every single file, flooding reviews with
            # false positives instead of real findings.
            common_globals = [
                "console", "window", "document", "navigator", "location",
                "history", "fetch", "localStorage", "sessionStorage",
                "setTimeout", "clearTimeout", "setInterval", "clearInterval",
                "alert", "prompt", "confirm", "Promise", "process",
                "require", "module", "exports", "global", "__dirname",
                "__filename", "Buffer",
            ]
            globals_js = ", ".join(f"{g}: 'readonly'" for g in common_globals)
            config_path = os.path.join(tmpdir, "eslint.config.mjs")
            with open(config_path, "w") as f:
                f.write(
                    "export default [{\n"
                    "  languageOptions: { ecmaVersion: 'latest', sourceType: 'module',"
                    " parserOptions: { ecmaFeatures: { jsx: true } },\n"
                    f"    globals: {{ {globals_js} }} }},\n"
                    "  rules: {\n"
                    "    'no-undef': 'error', 'no-unused-vars': 'warn',\n"
                    "    'no-dupe-keys': 'error', 'no-dupe-args': 'error',\n"
                    "    'no-unreachable': 'error', 'no-const-assign': 'error',\n"
                    "    'no-dupe-class-members': 'error', 'no-fallthrough': 'warn',\n"
                    "    'no-self-assign': 'error', 'no-self-compare': 'warn',\n"
                    "    'no-empty': 'warn', 'no-extra-boolean-cast': 'warn',\n"
                    "    'use-isnan': 'error', 'valid-typeof': 'error',\n"
                    "  },\n"
                    "}];\n"
                )
        else:
            config_path = os.path.join(tmpdir, ".eslintrc.json")
            with open(config_path, "w") as f:
                json.dump({
                    "extends": ["eslint:recommended"],
                    "parserOptions": {
                        "ecmaVersion": "latest", "sourceType": "module",
                        "ecmaFeatures": {"jsx": True},
                    },
                    "env": {"browser": True, "node": True, "es2021": True},
                }, f)
        return config_path

    def _run_eslint(self, files: dict[str, str],
                    result: StaticAnalysisResult) -> None:
        major = self._get_eslint_major()
        if major is None:
            result.tools_unavailable.append("eslint")
            return
        result.tools_run.append("eslint")

        with tempfile.TemporaryDirectory() as tmpdir:
            file_map = self._write_temp_files(files, tmpdir)
            temp_paths = list(file_map.keys())
            config_path = self._write_eslint_config(tmpdir, major)

            cmd = ["eslint", "--format=json", "--config", config_path]
            cmd += ["--no-config-lookup"] if major >= 9 else ["--no-eslintrc"]
            cmd += temp_paths

            try:
                proc = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=60,
                    cwd=tmpdir,
                )
            except (subprocess.TimeoutExpired, FileNotFoundError):
                logger.warning("eslint execution failed")
                return

            try:
                eslint_output = json.loads(proc.stdout) if proc.stdout else []
            except json.JSONDecodeError:
                logger.warning(
                    "eslint returned non-JSON output (exit %d): %s",
                    proc.returncode, proc.stderr[:300],
                )
                return

            for file_result in eslint_output:
                temp_path = file_result.get("filePath", "")
                original_path = file_map.get(temp_path, temp_path)
                for msg in file_result.get("messages", []):
                    sev = msg.get("severity", 1)
                    # dict.get(k, default) only falls back when the key is
                    # MISSING — ESLint always includes "ruleId" but sets it
                    # to null for fatal parse errors (e.g. real TypeScript
                    # syntax, which plain ESLint's parser can't read), so
                    # `.get("ruleId", "")` still returns None here and broke
                    # the (non-optional) API schema downstream.
                    result.issues.append(StaticIssue(
                        file=original_path,
                        line=msg.get("line") or 0,
                        column=msg.get("column") or 0,
                        severity="error" if sev == 2 else "warning",
                        rule=msg.get("ruleId") or "parse-error",
                        message=msg.get("message") or "",
                        tool="eslint",
                    ))

    @staticmethod
    def _write_temp_files(files: dict[str, str],
                          tmpdir: str) -> dict[str, str]:
        """Write files to temp dir, return {temp_path: original_path}."""
        file_map = {}
        for original_path, content in files.items():
            safe_name = original_path.replace("/", "_").replace("\\", "_")
            temp_path = os.path.join(tmpdir, safe_name)
            with open(temp_path, "w", encoding="utf-8") as f:
                f.write(content)
            file_map[temp_path] = original_path
        return file_map

    @staticmethod
    def _parse_flake8_line(line: str,
                           file_map: dict[str, str]) -> StaticIssue | None:
        # Format: /path/file.py:10:1: E302 expected 2 blank lines
        parts = line.split(":", 3)
        if len(parts) < 4:
            return None
        filepath = parts[0].strip()
        original = file_map.get(filepath, filepath)
        try:
            lineno = int(parts[1].strip())
            col = int(parts[2].strip())
        except ValueError:
            return None
        remainder = parts[3].strip()
        code_end = remainder.find(" ")
        if code_end == -1:
            code = remainder
            message = ""
        else:
            code = remainder[:code_end]
            message = remainder[code_end + 1:]

        severity = "error" if code.startswith("E") else "warning"
        return StaticIssue(
            file=original,
            line=lineno,
            column=col,
            severity=severity,
            rule=code,
            message=message,
            tool="flake8",
        )
