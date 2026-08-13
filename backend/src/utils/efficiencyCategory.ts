import { EfficiencyCategory } from "../types";

// High >= 85%, Medium 50–85%, Risk < 50%.
export const HIGH_EFFICIENCY_THRESHOLD = 85;
export const RISK_EFFICIENCY_THRESHOLD = 50;

export function categorizeEfficiency(efficiency: number): EfficiencyCategory {
  if (efficiency >= HIGH_EFFICIENCY_THRESHOLD) return "high";
  if (efficiency >= RISK_EFFICIENCY_THRESHOLD) return "medium";
  return "risk";
}
