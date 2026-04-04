import logging
import os

import pandas as pd

from config.settings import Settings
from dataset.labeler import Labeler

logger = logging.getLogger(__name__)


class DatasetBuilder:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.labeler = Labeler(settings)

    def build(self, raw_data: list[dict]) -> pd.DataFrame:
        if not raw_data:
            logger.warning("No data to build dataset from")
            return pd.DataFrame()

        df = pd.DataFrame(raw_data)
        df = self.labeler.generate_labels(df)
        return df

    def save(self, df: pd.DataFrame, filename: str = "pr_dataset.csv") -> str:
        output_dir = self.settings.data_output_dir
        os.makedirs(output_dir, exist_ok=True)
        path = os.path.join(output_dir, filename)
        df.to_csv(path, index=False)
        logger.info("Dataset saved to %s (%d rows)", path, len(df))
        return path

    def load(self, filename: str = "pr_dataset.csv") -> pd.DataFrame:
        path = os.path.join(self.settings.data_output_dir, filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Dataset not found: {path}")
        df = pd.read_csv(path)
        logger.info("Dataset loaded from %s (%d rows)", path, len(df))

        # Check for feedback data
        feedback_path = os.path.join(self.settings.data_output_dir, "feedback.csv")
        if os.path.exists(feedback_path):
            try:
                feedback_df = pd.read_csv(feedback_path)
                logger.info("Feedback dataset loaded from %s (%d rows)", feedback_path, len(feedback_df))
                
                # feedback_df has 'user_corrected_risk'. We need to map it to 'needs_major_changes'
                if 'user_corrected_risk' in feedback_df.columns:
                    feedback_df['needs_major_changes'] = feedback_df['user_corrected_risk']
                
                # Merge logic: if a PR in original df is in feedback_df, drop it from original and append feedback
                if 'pr_url' in feedback_df.columns and 'pr_url' in df.columns:
                    df = df[~df['pr_url'].isin(feedback_df['pr_url'])]
                elif 'pr_id' in feedback_df.columns and 'pr_id' in df.columns:
                    df = df[~df['pr_id'].isin(feedback_df['pr_id'])]

                # Ensure same columns before concat (ignore extras in feedback)
                common_cols = df.columns.intersection(feedback_df.columns)
                df = pd.concat([df, feedback_df[common_cols]], ignore_index=True)
                logger.info("Merged feedback data. Total dataset size: %d rows", len(df))
            except Exception as e:
                logger.error("Failed to merge feedback data: %s", e)

        return df
