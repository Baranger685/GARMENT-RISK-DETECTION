import { MlPredictionResponse } from "../types";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5001";

interface PredictInput {
  actual_output: number;
  smv: number;
  available_minutes: number;
  target_efficiency?: number;
  worker_history_avg?: number | null;
  history?: number[];
}

/**
 * Calls the Python ML service to get efficiency/risk/outlier predictions.
 * Falls back to a local calculation (same formula) if the ML service is
 * unreachable, so the app degrades gracefully instead of failing a submit.
 */
export async function getPrediction(input: PredictInput): Promise<MlPredictionResponse> {
  try {
    const res = await fetch(`${ML_SERVICE_URL}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`ML service responded with ${res.status}`);
    }

    return (await res.json()) as MlPredictionResponse;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mlClient] Falling back to local calculation:", (err as Error).message);
    return localFallback(input);
  }
}

function localFallback(input: PredictInput): MlPredictionResponse {
  const target = input.target_efficiency ?? 100;
  const efficiency = Number(
    (((input.actual_output * input.smv) / input.available_minutes) * 100).toFixed(2)
  );
  const variance = Number((((efficiency - target) / target) * 100).toFixed(2));
  const absVar = Math.abs(variance);
  const risk_level = absVar <= 10 ? "low" : absVar <= 25 ? "medium" : "high";

  let is_low_efficiency = efficiency < 50;
  if (!is_low_efficiency && input.worker_history_avg && input.worker_history_avg > 0) {
    const drop = ((input.worker_history_avg - efficiency) / input.worker_history_avg) * 100;
    if (drop >= 15) is_low_efficiency = true;
  }

  return {
    efficiency,
    variance,
    risk_level,
    is_low_efficiency,
    is_outlier: false,
    target_efficiency: target,
    formula: "((actual_output * smv) / available_minutes) * 100",
  };
}
