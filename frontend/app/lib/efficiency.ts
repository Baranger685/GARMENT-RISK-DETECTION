import { EfficiencyCategory } from "./types";

export interface PredictionResult {
  efficiency: number;
  variance: number;
  risk_level: "low" | "medium" | "high";
  is_low_efficiency: boolean;
}

const ABSOLUTE_FLOOR = 50;
const RELATIVE_DROP_PCT = 15;

// High >= 85%, Medium 50–85%, Risk < 50% — mirrors
// backend/src/utils/efficiencyCategory.ts.
export const HIGH_EFFICIENCY_THRESHOLD = 85;
export const RISK_EFFICIENCY_THRESHOLD = 50;

export function categorizeEfficiency(efficiency: number): EfficiencyCategory {
  if (efficiency >= HIGH_EFFICIENCY_THRESHOLD) return "high";
  if (efficiency >= RISK_EFFICIENCY_THRESHOLD) return "medium";
  return "risk";
}

/** Sri Lankan garment industry efficiency formula, computed client-side for demo mode. */
export function calculateEfficiency(
  actualOutput: number,
  smv: number,
  availableMinutes: number,
  targetEfficiency: number = 100,
  workerHistoryAvg?: number | null
): PredictionResult {
  const efficiency = Number((((actualOutput * smv) / availableMinutes) * 100).toFixed(2));
  const variance = Number((((efficiency - targetEfficiency) / targetEfficiency) * 100).toFixed(2));
  const absVar = Math.abs(variance);
  const risk_level: "low" | "medium" | "high" = absVar <= 10 ? "low" : absVar <= 25 ? "medium" : "high";

  let is_low_efficiency = efficiency < ABSOLUTE_FLOOR;
  if (!is_low_efficiency && workerHistoryAvg && workerHistoryAvg > 0) {
    const drop = ((workerHistoryAvg - efficiency) / workerHistoryAvg) * 100;
    if (drop >= RELATIVE_DROP_PCT) is_low_efficiency = true;
  }

  return { efficiency, variance, risk_level, is_low_efficiency };
}
