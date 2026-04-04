import logging
import os
from dataclasses import dataclass

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict

logger = logging.getLogger(__name__)


@dataclass
class ModelResult:
    name: str
    accuracy: float
    precision: float
    recall: float
    f1: float
    model: object


class ModelTrainer:
    def __init__(self):
        self.models = {
            "LogisticRegression": LogisticRegression(
                max_iter=1000, class_weight="balanced", random_state=42
            ),
            "RandomForest": RandomForestClassifier(
                n_estimators=100, class_weight="balanced", random_state=42
            ),
        }
        self.best_model = None
        self.best_model_name = None

    def train_and_evaluate(self, X: np.ndarray,
                           y: np.ndarray) -> list[ModelResult]:
        results = []
        n_splits = min(5, max(2, int(len(y) / 2)))
        cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)

        for name, model in self.models.items():
            logger.info("Training %s...", name)

            try:
                y_pred = cross_val_predict(model, X, y, cv=cv)
            except ValueError:
                # Fall back to simple train if CV fails
                model.fit(X, y)
                y_pred = model.predict(X)

            result = ModelResult(
                name=name,
                accuracy=accuracy_score(y, y_pred),
                precision=precision_score(y, y_pred, zero_division=0),
                recall=recall_score(y, y_pred, zero_division=0),
                f1=f1_score(y, y_pred, zero_division=0),
                model=model,
            )
            results.append(result)

            logger.info(
                "%s — Acc: %.3f | Prec: %.3f | Rec: %.3f | F1: %.3f",
                name, result.accuracy, result.precision,
                result.recall, result.f1,
            )

        # Select best by F1
        best = max(results, key=lambda r: r.f1)
        self.best_model_name = best.name
        # Refit best model on full data
        best.model.fit(X, y)
        self.best_model = best.model
        logger.info("Best model: %s (F1=%.3f)", best.name, best.f1)
        return results

    def save(self, output_dir: str) -> str:
        if self.best_model is None:
            raise RuntimeError("No model has been trained yet")

        os.makedirs(output_dir, exist_ok=True)
        path = os.path.join(output_dir, "pr_risk_model.pkl")
        joblib.dump({
            "model": self.best_model,
            "model_name": self.best_model_name,
        }, path)
        logger.info("Model saved to %s", path)
        return path

    @classmethod
    def load(cls, output_dir: str) -> "ModelTrainer":
        path = os.path.join(output_dir, "pr_risk_model.pkl")
        if not os.path.exists(path):
            raise FileNotFoundError(f"Model not found: {path}")

        data = joblib.load(path)
        trainer = cls()
        trainer.best_model = data["model"]
        trainer.best_model_name = data["model_name"]
        logger.info("Model loaded: %s from %s", data["model_name"], path)
        return trainer

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self.best_model is None:
            raise RuntimeError("No model loaded")
        return self.best_model.predict(X)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        if self.best_model is None:
            raise RuntimeError("No model loaded")
        return self.best_model.predict_proba(X)
