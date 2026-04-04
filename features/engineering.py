import logging
import os

import joblib
import numpy as np
import pandas as pd
from scipy.sparse import hstack, issparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

NUMERIC_FEATURES = [
    "files_changed_count",
    "lines_added",
    "lines_deleted",
    "commits_count",
    "comments_count",
    "approvals_count",
    "tasks_count",
    "merge_duration_hours",
]


class FeatureEngineer:
    def __init__(self):
        self.title_vectorizer = TfidfVectorizer(
            max_features=200, stop_words="english", ngram_range=(1, 2)
        )
        self.desc_vectorizer = TfidfVectorizer(
            max_features=300, stop_words="english", ngram_range=(1, 2)
        )
        self.scaler = StandardScaler()
        self._fitted = False

    def fit_transform(self, df: pd.DataFrame) -> np.ndarray:
        title_text = df["title"].fillna("").astype(str)
        desc_text = df["description"].fillna("").astype(str)

        title_tfidf = self.title_vectorizer.fit_transform(title_text)
        desc_tfidf = self.desc_vectorizer.fit_transform(desc_text)

        numeric_df = df[NUMERIC_FEATURES].fillna(0).astype(float)
        numeric_scaled = self.scaler.fit_transform(numeric_df)

        feature_matrix = hstack([
            title_tfidf,
            desc_tfidf,
            numeric_scaled,
        ])

        self._fitted = True
        logger.info("Feature matrix shape: %s", feature_matrix.shape)
        return feature_matrix

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        if not self._fitted:
            raise RuntimeError("FeatureEngineer has not been fitted yet")

        title_text = df["title"].fillna("").astype(str)
        desc_text = df["description"].fillna("").astype(str)

        title_tfidf = self.title_vectorizer.transform(title_text)
        desc_tfidf = self.desc_vectorizer.transform(desc_text)

        numeric_df = df[NUMERIC_FEATURES].fillna(0).astype(float)
        numeric_scaled = self.scaler.transform(numeric_df)

        feature_matrix = hstack([
            title_tfidf,
            desc_tfidf,
            numeric_scaled,
        ])
        return feature_matrix

    def save(self, output_dir: str) -> None:
        os.makedirs(output_dir, exist_ok=True)
        path = os.path.join(output_dir, "vectorizer.pkl")
        joblib.dump({
            "title_vectorizer": self.title_vectorizer,
            "desc_vectorizer": self.desc_vectorizer,
            "scaler": self.scaler,
            "fitted": self._fitted,
        }, path)
        logger.info("Feature engineering artifacts saved to %s", path)

    @classmethod
    def load(cls, output_dir: str) -> "FeatureEngineer":
        path = os.path.join(output_dir, "vectorizer.pkl")
        if not os.path.exists(path):
            raise FileNotFoundError(f"Vectorizer not found: {path}")

        data = joblib.load(path)
        engineer = cls()
        engineer.title_vectorizer = data["title_vectorizer"]
        engineer.desc_vectorizer = data["desc_vectorizer"]
        engineer.scaler = data["scaler"]
        engineer._fitted = data["fitted"]
        logger.info("Feature engineering artifacts loaded from %s", path)
        return engineer
