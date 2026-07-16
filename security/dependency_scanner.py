import json
import logging
import re
from dataclasses import dataclass, field

import requests

logger = logging.getLogger(__name__)

OSV_API_URL = "https://api.osv.dev/v1/query"

# Maps dependency file names to their ecosystem and parser
SUPPORTED_FILES = {
    "package.json": "npm",
    "requirements.txt": "PyPI",
    "composer.json": "Packagist",
    "pom.xml": "Maven",
    "Gemfile": "RubyGems",
    "go.mod": "Go",
    "Cargo.toml": "crates.io",
}


@dataclass
class Vulnerability:
    package: str
    version: str
    ecosystem: str
    vuln_id: str
    summary: str
    severity: str  # "CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"
    fixed_version: str = ""

    def to_dict(self) -> dict:
        return {
            "package": self.package,
            "version": self.version,
            "ecosystem": self.ecosystem,
            "vuln_id": self.vuln_id,
            "summary": self.summary,
            "severity": self.severity,
            "fixed_version": self.fixed_version,
        }


@dataclass
class ScanResult:
    scanned_files: list[str] = field(default_factory=list)
    vulnerabilities: list[Vulnerability] = field(default_factory=list)
    packages_checked: int = 0
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "scanned_files": self.scanned_files,
            "vulnerabilities": [v.to_dict() for v in self.vulnerabilities],
            "packages_checked": self.packages_checked,
            "error": self.error,
        }


class DependencyScanner:
    def __init__(self, timeout: int = 10):
        self.timeout = timeout

    def scan_changed_files(self, changed_files: list[str],
                           file_contents: dict[str, str]) -> ScanResult:
        """Scan dependency files for vulnerabilities.

        Args:
            changed_files: List of changed file paths.
            file_contents: Map of file path -> file content for dependency files.
        """
        result = ScanResult()
        dep_files = self._find_dependency_files(changed_files)

        if not dep_files:
            return result

        for filepath, ecosystem in dep_files:
            result.scanned_files.append(filepath)
            content = file_contents.get(filepath, "")
            if not content:
                logger.warning("No content available for %s, skipping",
                               filepath)
                continue

            packages = self._parse_packages(filepath, content, ecosystem)
            result.packages_checked += len(packages)

            for name, version in packages:
                vulns = self._check_osv(name, version, ecosystem)
                result.vulnerabilities.extend(vulns)

        logger.info(
            "Scanned %d dependency files, checked %d packages, "
            "found %d vulnerabilities",
            len(result.scanned_files), result.packages_checked,
            len(result.vulnerabilities),
        )
        return result

    @staticmethod
    def _find_dependency_files(
            changed_files: list[str]) -> list[tuple[str, str]]:
        matches = []
        for filepath in changed_files:
            basename = filepath.rsplit("/", maxsplit=1)[-1]
            if basename in SUPPORTED_FILES:
                matches.append((filepath, SUPPORTED_FILES[basename]))
        return matches

    def _parse_packages(self, filepath: str, content: str,
                        ecosystem: str) -> list[tuple[str, str]]:
        basename = filepath.rsplit("/", maxsplit=1)[-1]
        try:
            if basename == "requirements.txt":
                return self._parse_requirements_txt(content)
            if basename == "package.json":
                return self._parse_package_json(content)
            if basename == "composer.json":
                return self._parse_composer_json(content)
            if basename == "pom.xml":
                return self._parse_pom_xml(content)
            if basename == "Gemfile":
                return self._parse_gemfile(content)
            if basename == "go.mod":
                return self._parse_go_mod(content)
            if basename == "Cargo.toml":
                return self._parse_cargo_toml(content)
        except Exception:
            logger.exception("Failed to parse %s", filepath)
        return []

    @staticmethod
    def _parse_requirements_txt(content: str) -> list[tuple[str, str]]:
        packages = []
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("-"):
                continue
            match = re.match(r"^([a-zA-Z0-9_.-]+)\s*[=~!><]=?\s*([0-9.]+)",
                             line)
            if match:
                packages.append((match.group(1), match.group(2)))
        return packages

    @staticmethod
    def _parse_package_json(content: str) -> list[tuple[str, str]]:
        packages = []
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            return packages
        for section in ("dependencies", "devDependencies"):
            deps = data.get(section, {})
            for name, version_spec in deps.items():
                version = re.sub(r"[^0-9.]", "", version_spec).strip(".")
                if version:
                    packages.append((name, version))
        return packages

    @staticmethod
    def _parse_composer_json(content: str) -> list[tuple[str, str]]:
        packages = []
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            return packages
        for section in ("require", "require-dev"):
            deps = data.get(section, {})
            for name, version_spec in deps.items():
                if name == "php" or name.startswith("ext-"):
                    continue
                version = re.sub(r"[^0-9.]", "", version_spec).strip(".")
                if version:
                    packages.append((name, version))
        return packages

    @staticmethod
    def _parse_pom_xml(content: str) -> list[tuple[str, str]]:
        packages = []
        dep_pattern = re.compile(
            r"<dependency>\s*"
            r"<groupId>([^<]+)</groupId>\s*"
            r"<artifactId>([^<]+)</artifactId>\s*"
            r"<version>([^<]+)</version>",
            re.DOTALL,
        )
        for match in dep_pattern.finditer(content):
            group_id = match.group(1).strip()
            artifact_id = match.group(2).strip()
            version = match.group(3).strip()
            if version and not version.startswith("$"):
                packages.append((f"{group_id}:{artifact_id}", version))
        return packages

    @staticmethod
    def _parse_gemfile(content: str) -> list[tuple[str, str]]:
        packages = []
        for line in content.splitlines():
            match = re.match(
                r"""^\s*gem\s+['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]""",
                line,
            )
            if match:
                name = match.group(1)
                version = re.sub(r"[^0-9.]", "", match.group(2)).strip(".")
                if version:
                    packages.append((name, version))
        return packages

    @staticmethod
    def _parse_go_mod(content: str) -> list[tuple[str, str]]:
        packages = []
        for line in content.splitlines():
            line = line.strip()
            match = re.match(r"^(\S+)\s+(v[0-9.]+)", line)
            if match and "/" in match.group(1):
                packages.append(
                    (match.group(1), match.group(2).lstrip("v")))
        return packages

    @staticmethod
    def _parse_cargo_toml(content: str) -> list[tuple[str, str]]:
        packages = []
        in_deps = False
        for line in content.splitlines():
            stripped = line.strip()
            if re.match(r"^\[.*dependencies.*\]", stripped):
                in_deps = True
                continue
            if stripped.startswith("[") and in_deps:
                in_deps = False
                continue
            if in_deps:
                match = re.match(
                    r"""^([a-zA-Z0-9_-]+)\s*=\s*['"]([\d.]+)['"]""",
                    stripped,
                )
                if match:
                    packages.append((match.group(1), match.group(2)))
        return packages

    def _check_osv(self, package: str, version: str,
                   ecosystem: str) -> list[Vulnerability]:
        payload = {
            "version": version,
            "package": {
                "name": package,
                "ecosystem": ecosystem,
            },
        }

        try:
            resp = requests.post(
                OSV_API_URL, json=payload, timeout=self.timeout
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException:
            logger.warning("OSV query failed for %s@%s", package, version)
            return []

        vulns_raw = data.get("vulns", [])
        if not vulns_raw:
            return []

        results = []
        for v in vulns_raw:
            severity = self._extract_severity(v)
            fixed = self._extract_fixed_version(v, package, ecosystem)
            results.append(Vulnerability(
                package=package,
                version=version,
                ecosystem=ecosystem,
                vuln_id=v.get("id", ""),
                summary=v.get("summary", v.get("details", "")[:300]),
                severity=severity,
                fixed_version=fixed,
            ))

        return results

    @staticmethod
    def _extract_severity(vuln: dict) -> str:
        # Try database_specific first, then severity array
        for sev in vuln.get("severity", []):
            score_str = sev.get("score", "")
            if "CVSS" in sev.get("type", ""):
                # Parse CVSS score from vector or score field
                try:
                    score = float(score_str) if score_str else 0
                except (ValueError, TypeError):
                    score = 0
                if score >= 9.0:
                    return "CRITICAL"
                if score >= 7.0:
                    return "HIGH"
                if score >= 4.0:
                    return "MEDIUM"
                if score > 0:
                    return "LOW"

        db_sev = (vuln.get("database_specific") or {}).get("severity", "")
        if db_sev:
            return db_sev.upper()

        return "UNKNOWN"

    @staticmethod
    def _extract_fixed_version(vuln: dict, package: str,
                               ecosystem: str) -> str:
        for affected in vuln.get("affected", []):
            pkg = affected.get("package", {})
            if (pkg.get("name", "") == package
                    and pkg.get("ecosystem", "") == ecosystem):
                for rng in affected.get("ranges", []):
                    for event in rng.get("events", []):
                        fixed = event.get("fixed", "")
                        if fixed:
                            return fixed
        return ""
