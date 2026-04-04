#!/usr/bin/env python3
"""Collect PR data from configured Bitbucket repositories and build a dataset."""

import argparse
import logging
import sys

from config.settings import Settings
from data_collection.collector import DataCollector
from dataset.builder import DatasetBuilder


def main():
    parser = argparse.ArgumentParser(
        description="Collect PR data from Bitbucket and build training dataset"
    )
    parser.add_argument(
        "--env", default=".env",
        help="Path to .env file (default: .env)",
    )
    parser.add_argument(
        "--output", default="pr_dataset.csv",
        help="Output CSV filename (default: pr_dataset.csv)",
    )
    parser.add_argument(
        "--repos", nargs="*",
        help="Override repositories (workspace/repo format)",
    )
    parser.add_argument(
        "--limit", type=int,
        help="Override PR fetch limit per state per repo",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true",
        help="Enable verbose logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    settings = Settings.load(args.env)

    if args.repos:
        settings.repositories = args.repos
    if args.limit:
        settings.pr_fetch_limit = args.limit

    if not settings.repositories:
        print("ERROR: No repositories configured. Set BITBUCKET_REPOSITORIES "
              "in .env or use --repos.", file=sys.stderr)
        sys.exit(1)

    if not settings.bitbucket_username or not settings.bitbucket_app_password:
        print("ERROR: Bitbucket credentials not configured. "
              "Set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD in .env.",
              file=sys.stderr)
        sys.exit(1)

    print(f"Collecting PRs from {len(settings.repositories)} repository(ies)...")
    collector = DataCollector(settings)
    raw_data = collector.collect_all()

    if not raw_data:
        print("No PR data collected. Check your configuration and credentials.")
        sys.exit(1)

    builder = DatasetBuilder(settings)
    df = builder.build(raw_data)
    output_path = builder.save(df, args.output)

    print(f"\nDataset built successfully:")
    print(f"  Total PRs: {len(df)}")
    print(f"  Needs major changes: {df['needs_major_changes'].sum()}")
    print(f"  Saved to: {output_path}")


if __name__ == "__main__":
    main()
