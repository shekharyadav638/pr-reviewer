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
                    line=item.get("line", 0),
                    column=item.get("column", 0),
                    severity=severity,
                    rule=item.get("message-id", item.get("symbol", "")),
                    message=item.get("message", ""),
                    tool="pylint",
                ))

    def _run_eslint(self, files: dict[str, str],
                    result: StaticAnalysisResult) -> None:
        result.tools_run.append("eslint")
        with tempfile.TemporaryDirectory() as tmpdir:
            file_map = self._write_temp_files(files, tmpdir)
            temp_paths = list(file_map.keys())

            try:
                proc = subprocess.run(
                    ["eslint", "--format=json", "--no-eslintrc",
                     *temp_paths],
                    capture_output=True, text=True, timeout=60,
                    cwd=tmpdir,
                )
            except (subprocess.TimeoutExpired, FileNotFoundError):
                logger.warning("eslint execution failed")
                return

            try:
                eslint_output = json.loads(proc.stdout) if proc.stdout else []
            except json.JSONDecodeError:
                return

            for file_result in eslint_output:
                temp_path = file_result.get("filePath", "")
                original_path = file_map.get(temp_path, temp_path)
                for msg in file_result.get("messages", []):
                    sev = msg.get("severity", 1)
                    result.issues.append(StaticIssue(
                        file=original_path,
                        line=msg.get("line", 0),
                        column=msg.get("column", 0),
                        severity="error" if sev == 2 else "warning",
                        rule=msg.get("ruleId", ""),
                        message=msg.get("message", ""),
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
