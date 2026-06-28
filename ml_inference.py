import json
import logging
import numpy as np
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

class MLInference:    
    def __init__(self):
        self.centroid_path = Path("data/centroid_knn.json")
        self.classes = ["Open_Grip", "Closed_Grip", "Cylindrical", "Spherical", "Hook_Grasp"]
        self.sensor_weights = np.array([0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0])
        max_diff = np.ones(10) * 100.0
        self.max_dist = np.sqrt(np.sum(self.sensor_weights * (max_diff)**2))
        self.threshold_dist = 20.0 
        self.centroids = self._load_and_average_centroids()

    def _load_and_average_centroids(self) -> Dict[str, np.ndarray]:
        centroids = {}
        if self.centroid_path.exists():
            try:
                with open(self.centroid_path, 'r') as f:
                    data = json.load(f)
                    for grasp_name in self.classes:
                        if grasp_name in data:
                            centroids[grasp_name] = np.mean(data[grasp_name], axis=0)
                logger.info(f"Successfully loaded {len(centroids)} centroids from {self.centroid_path}")
            except Exception as e:
                logger.error(f"Failed to load centroids: {e}")
        else:
            logger.error(f"{self.centroid_path} not found! Prediction will fail.")
            
        return centroids

    def predict(self, raw_sensors: list, target_task: Optional[str] = None) -> dict:
        if not self.centroids or len(raw_sensors) < 10:
            return {"classification": "Waiting...", "error_pct": 0, "pwm_intensity": 0}

        current = np.array(raw_sensors[:10])
        distances = {}

        for grasp_name, target in self.centroids.items():
            dist = np.sqrt(np.sum(self.sensor_weights * (target - current)**2))
            distances[grasp_name] = dist

        # 1. This finds the absolute lowest line on the graph right now:
        best_match = min(distances, key=distances.get)
        min_dist = distances[best_match]
        confidence = max(0, 100 - (min_dist / self.max_dist * 100))

        # 2. Assign best_match directly so frontend updates synchronously with the chart line
        result = {
            "classification": best_match, 
            "confidence": float(confidence),
            "distances": distances,
            "pwm_intensity": 0,
            "error_pct": 0.0
        }

        # Leave target_task specific logic for underlying feedback loops only,
        # ensuring it doesn't mask or throttle the real-time classification metric
        if target_task and target_task in self.centroids:
            target_dist = distances[target_task]
            if target_dist <= self.threshold_dist:
                result["error_pct"] = 0.0
                result["pwm_intensity"] = 0
            else:
                result["error_pct"] = min(100.0, (target_dist / self.max_dist) * 100.0)
                result["pwm_intensity"] = int((result["error_pct"] / 100.0) * 255)

        return result