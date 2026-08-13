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
  next_entry_allowed_at?: string | null;
  created_at: string;
  submissions_today?: number;
  avg_efficiency_today?: number;
  efficiency_category?: EfficiencyCategory;
}

export interface ProductionLog {
  id: number;
  worker_id: number;
  worker_name?: string;
  line: string;
  entry_number?: number;
  actual_output: number;
  smv: number;
  available_minutes: number;
  efficiency: number;
  target_efficiency: number;
  target_per_hour?: number | null;
  target_per_day?: number | null;
  variance: number;
  risk_level: "low" | "medium" | "high";
  efficiency_category?: EfficiencyCategory;
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
  worker_name?: string;
  worker_line?: string;
  production_id: number | null;
  type: "risk" | "flagged" | "downtime";
  severity: "low" | "medium" | "high";
  message: string;
  acknowledged: boolean;
  employee_seen?: boolean;
  created_at: string;
}

export interface LineTarget {
  line: string;
  target_per_hour: number;
  target_per_day: number;
  updated_at: string;
}

export interface DashboardSummary {
  kpis: {
    total_logs_today: number;
    avg_efficiency: number;
    high_risk_count: number;
    medium_risk_count: number;
    low_risk_count: number;
  };
  hourly_trend: { hour: string; avg_efficiency: number; submissions: number }[];
  flagged_workers: {
    id: number;
    name: string;
    line: string;
    low_efficiency_count: number;
    flagged_at: string | null;
  }[];
  risk_workers: {
    id: number;
    name: string;
    line: string;
    avg_efficiency_today: number;
    flagged: boolean;
  }[];
  recent_logs: ProductionLog[];
}
