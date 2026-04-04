#!/usr/bin/env python3
"""Train the PR risk prediction model from collected dataset."""

import argparse
import logging
import sys

import numpy as np

from config.settings import Settings
from dataset.builder import DatasetBuilder
from features.engineering import FeatureEngineer
from models.trainer import ModelTrainer
from rules.hotspot import HotspotDetector


def main():
    parser = argparse.ArgumentParser(
        description="Train the PR risk prediction model"
    )
    parser.add_argument(
        "--env", default=".env",
        help="Path to .env file (default: .env)",
    )
    parser.add_argument(
        "--dataset", default="pr_dataset.csv",
        help="Dataset CSV filename (default: pr_dataset.csv)",
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

    # Load dataset
    builder = DatasetBuilder(settings)
    try:
        df = builder.load(args.dataset)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("Run collect_data.py first to build the dataset.", file=sys.stderr)
        sys.exit(1)

    if len(df) < 10:
        print(f"WARNING: Only {len(df)} PRs in dataset. "
              "Model quality may be poor with small datasets.", file=sys.stderr)

    print(f"Dataset: {len(df)} PRs")
    print(f"  Positive (needs_major_changes=1): "
          f"{df['needs_major_changes'].sum()}")
    print(f"  Negative (needs_major_changes=0): "
          f"{(df['needs_major_changes'] == 0).sum()}")
    print()

    # Feature engineering
    print("Extracting features...")
    engineer = FeatureEngineer()
    X = engineer.fit_transform(df)
    y = df["needs_major_changes"].values.astype(int)

    # Check for degenerate labels
    if len(np.unique(y)) < 2:
        print("ERROR: Dataset has only one class. "
              "Need both positive and negative examples.", file=sys.stderr)
        sys.exit(1)

    # Train models
    print("Training models...")
    trainer = ModelTrainer()
    results = trainer.train_and_evaluate(X, y)

    print("\n" + "=" * 50)
    print("  MODEL EVALUATION RESULTS")
    print("=" * 50)
    for r in results:
        print(f"\n  {r.name}:")
        print(f"    Accuracy  : {r.accuracy:.4f}")
        print(f"    Precision : {r.precision:.4f}")
        print(f"    Recall    : {r.recall:.4f}")
        print(f"    F1 Score  : {r.f1:.4f}")

    print(f"\n  Best Model: {trainer.best_model_name}")
    print("=" * 50)

    # Save artifacts
    model_path = trainer.save(settings.model_output_dir)
    engineer.save(settings.model_output_dir)

    print(f"\nArtifacts saved to {settings.model_output_dir}/:")
    print(f"  - pr_risk_model.pkl")
    print(f"  - vectorizer.pkl")

    # Hotspot analysis
    print("\nRunning hotspot analysis...")
    detector = HotspotDetector()
    hotspots = detector.detect(df)
    if hotspots:
        print("\nTop hotspot files (frequently in risky PRs):")
        for h in hotspots[:10]:
            print(f"  {h['file']} — in {h['risk_pr_count']} risky PRs "
                  f"({h['risk_pr_percentage']}%)")
    else:
        print("  No hotspots detected.")

    print("\nTraining complete.")


if __name__ == "__main__":
    main()
