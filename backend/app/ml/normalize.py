"""Anomaly score normalisation (kept in its own module so the pickled model bundle is importable)."""

import numpy as np


class AnomalyNormalizer:
    def __init__(self, raw_train: np.ndarray) -> None:
        self.lo, self.hi = float(np.quantile(raw_train, 0.01)), float(np.quantile(raw_train, 0.999))

    def __call__(self, raw: np.ndarray) -> np.ndarray:
        return np.clip((raw - self.lo) / max(self.hi - self.lo, 1e-9), 0, 1)
