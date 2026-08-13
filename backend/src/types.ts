export type EfficiencyCategory = "high" | "medium" | "risk";

export interface Worker {
  id: number;
  name: string;
  line: string;
  smv: number;
  daily_target: number;
  skill_level: string;
  low_efficiency_count: number; // how many of the first 3 entries were < 50% efficiency
  flagged: boolean;
  flagged_at: string | null;
  pin_hash?: string | null;
  next_entry_allowed_at: string | null; // server-enforced 1-hour submission gap
  created_at: string;
}

export interface ProductionLog {
  id: number;
  worker_id: number;
  line: string;
  entry_number: number;
  actual_output: number;
  smv: number;
  available_minutes: number;
  efficiency: number;
  target_efficiency: number;
  target_per_hour: number | null;
  target_per_day: number | null;
  variance: number;
  risk_level: "low" | "medium" | "high";
  efficiency_category: EfficiencyCategory;
  is_low_efficiency: boolean;
  is_outlier: boolean;
  downtime_minutes: number;
  downtime_reason: string | null;
  notes: string | null;
  created_at: string;
}

export interface Alert {
  id: number;
  worker_id: number | null;
  production_id: number | null;
  type: "risk" | "flagged" | "downtime";
  severity: "low" | "medium" | "high";
  message: string;
  acknowledged: boolean;
  employee_seen: boolean;
  created_at: string;
}

export interface LineTarget {
  line: string;
  target_per_hour: number;
  target_per_day: number;
  updated_at: string;
}

export interface MlPredictionResponse {
  efficiency: number;
  variance: number;
  risk_level: "low" | "medium" | "high";
  is_low_efficiency: boolean;
  is_outlier: boolean;
  target_efficiency: number;
  formula: string;
}
