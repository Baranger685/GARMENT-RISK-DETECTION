"""
GarmentRisk ML Service
=======================
Implements:
  - Sri Lankan garment industry efficiency formula
  - Variance-based risk classification
  - Simple statistical outlier detection (z-score against worker/line history)

Efficiency (%) = ((Actual Output x SMV) / Total Available Minutes) x 100
"""

import os
import math
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DEFAULT_AVAILABLE_MINUTES = 480  # standard 8-hour shift
DEFAULT_TARGET_EFFICIENCY = 100.0

# ---------------------------------------------------------------
# Core formula helpers
# ---------------------------------------------------------------

def calc_efficiency(actual_output: float, smv: float, available_minutes: float) -> float:
    """Sri Lankan garment industry efficiency formula."""
    if available_minutes <= 0:
        raise ValueError("available_minutes must be > 0")
    return round(((actual_output * smv) / available_minutes) * 100, 2)


def calc_variance(efficiency: float, target_efficiency: float) -> float:
    """Percentage deviation of actual efficiency from target (can be negative)."""
    if target_efficiency == 0:
        return 0.0
    return round(((efficiency - target_efficiency) / target_efficiency) * 100, 2)


def classify_risk(variance: float) -> str:
    """
    Per README variance table:
      0-10%  -> low
      10-25% -> medium
      >25%   -> high
    Uses absolute variance (works whether the worker is over or under target).
    """
    abs_var = abs(variance)
    if abs_var <= 10:
        return "low"
    elif abs_var <= 25:
        return "medium"
    return "high"


def is_low_efficiency(efficiency: float, worker_history_avg: float = None) -> bool:
    """
    Combined low-efficiency rule (per product decision):
      - Efficiency below an absolute floor (50%), OR
      - Efficiency more than 15% below the worker's own historical average
        (only applied when at least one prior data point exists).
    """
    ABSOLUTE_FLOOR = 50.0
    RELATIVE_DROP_PCT = 15.0

    if efficiency < ABSOLUTE_FLOOR:
        return True

    if worker_history_avg is not None and worker_history_avg > 0:
        drop_pct = ((worker_history_avg - efficiency) / worker_history_avg) * 100
        if drop_pct >= RELATIVE_DROP_PCT:
            return True

    return False


def detect_outlier(efficiency: float, history: list) -> bool:
    """
    Simple z-score based outlier check against a worker/line's recent
    efficiency history. Flags a submission as an outlier when it is more
    than 2 standard deviations from the historical mean (requires >= 3
    prior points to be meaningful).
    """
    if not history or len(history) < 3:
        return False

    mean = sum(history) / len(history)
    variance = sum((x - mean) ** 2 for x in history) / len(history)
    std_dev = math.sqrt(variance)

    if std_dev == 0:
        return False

    z_score = (efficiency - mean) / std_dev
    return abs(z_score) > 2


# ---------------------------------------------------------------
# Routes
# ---------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "garment-ml-service"}), 200


@app.route("/api/predict", methods=["POST"])
def predict():
    data = request.get_json(force=True, silent=True) or {}

    try:
        actual_output = float(data["actual_output"])
        smv = float(data["smv"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "actual_output and smv are required numeric fields"}), 400

    available_minutes = float(data.get("available_minutes", DEFAULT_AVAILABLE_MINUTES))
    target_efficiency = float(data.get("target_efficiency", DEFAULT_TARGET_EFFICIENCY))
    worker_history_avg = data.get("worker_history_avg")
    worker_history_avg = float(worker_history_avg) if worker_history_avg is not None else None
    history = data.get("history", [])  # list of past efficiency values, optional

    try:
        efficiency = calc_efficiency(actual_output, smv, available_minutes)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    variance = calc_variance(efficiency, target_efficiency)
    risk_level = classify_risk(variance)
    low_eff = is_low_efficiency(efficiency, worker_history_avg)
    outlier = detect_outlier(efficiency, history)

    return jsonify({
        "efficiency": efficiency,
        "variance": variance,
        "risk_level": risk_level,
        "is_low_efficiency": low_eff,
        "is_outlier": outlier,
        "target_efficiency": target_efficiency,
        "formula": "((actual_output * smv) / available_minutes) * 100"
    }), 200


@app.route("/api/predict/batch", methods=["POST"])
def predict_batch():
    data = request.get_json(force=True, silent=True) or {}
    items = data.get("items", [])
    if not isinstance(items, list) or not items:
        return jsonify({"error": "items must be a non-empty list"}), 400

    results = []
    for item in items:
        try:
            actual_output = float(item["actual_output"])
            smv = float(item["smv"])
        except (KeyError, TypeError, ValueError):
            results.append({"error": "actual_output and smv are required numeric fields", "input": item})
            continue

        available_minutes = float(item.get("available_minutes", DEFAULT_AVAILABLE_MINUTES))
        target_efficiency = float(item.get("target_efficiency", DEFAULT_TARGET_EFFICIENCY))
        worker_history_avg = item.get("worker_history_avg")
        worker_history_avg = float(worker_history_avg) if worker_history_avg is not None else None
        history = item.get("history", [])

        efficiency = calc_efficiency(actual_output, smv, available_minutes)
        variance = calc_variance(efficiency, target_efficiency)
        risk_level = classify_risk(variance)

        results.append({
            "worker_id": item.get("worker_id"),
            "efficiency": efficiency,
            "variance": variance,
            "risk_level": risk_level,
            "is_low_efficiency": is_low_efficiency(efficiency, worker_history_avg),
            "is_outlier": detect_outlier(efficiency, history),
        })

    return jsonify({"results": results}), 200


@app.route("/api/outlier-check", methods=["POST"])
def outlier_check():
    data = request.get_json(force=True, silent=True) or {}
    try:
        efficiency = float(data["efficiency"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "efficiency is required"}), 400

    history = data.get("history", [])
    outlier = detect_outlier(efficiency, history)
    return jsonify({"is_outlier": outlier, "sample_size": len(history)}), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
