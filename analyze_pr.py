#!/usr/bin/env python3
"""Analyze a Bitbucket PR for risk and issues."""

import argparse
import logging
import sys

from config.settings import Settings
from analysis.analyzer import PRAnalyzer


def main():
    parser = argparse.ArgumentParser(
        description="Analyze a Bitbucket PR for risk and potential issues"
    )
    parser.add_argument(
        "--pr-url", required=True,
        help="Full Bitbucket PR URL "
             "(e.g., https://bitbucket.org/workspace/repo/pull-requests/123)",
    )
    parser.add_argument(
        "--env", default=".env",
        help="Path to .env file (default: .env)",
    )
    parser.add_argument(
        "--format", choices=["text", "json"], default="text",
        help="Output format (default: text)",
    )
    parser.add_argument(
        "--no-model", action="store_true",
        help="Skip ML model prediction (rule-based only)",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true",
        help="Enable verbose logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    settings = Settings.load(args.env)

    if not settings.bitbucket_username or not settings.bitbucket_app_password:
        print("ERROR: Bitbucket credentials not configured. "
              "Set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD in .env.",
              file=sys.stderr)
        sys.exit(1)

    analyzer = PRAnalyzer(settings)

    if not args.no_model:
        try:
            analyzer.load_model()
        except FileNotFoundError:
            print("WARNING: No trained model found. "
                  "Running rule-based analysis only.", file=sys.stderr)
            print("Run train_model.py first for ML-based predictions.\n",
                  file=sys.stderr)

    analyzer.load_dataset()

    try:
        report = analyzer.analyze_pr(args.pr_url)
    except Exception as e:
        print(f"ERROR: Failed to analyze PR: {e}", file=sys.stderr)
        logging.exception("Analysis failed")
        sys.exit(1)

    if args.format == "json":
        print(report.to_json())
    else:
        print(report.to_text())


if __name__ == "__main__":
    main()
