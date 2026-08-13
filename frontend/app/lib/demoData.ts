import { Worker, ProductionLog, Alert, DashboardSummary, LineTarget } from "./types";
import { categorizeEfficiency } from "./efficiency";

// Demo-mode-only PINs (plaintext here purely because this is static,
// offline sample data with no real backend behind it — the real system
// always stores bcrypt-hashed PINs server-side, see database/schema.sql).
export const DEMO_EMPLOYEE_PINS: Record<string, number> = {
  "1001": 1,
  "1002": 2,
  "1003": 3,
  "1004": 4,
  "1005": 5,
  "1006": 6,
  "1007": 7,
  "1008": 8,
};
export const DEMO_SUPERVISOR_PINS: Record<string, { id: number; name: string; role: "supervisor" | "admin"; line: string | null }> = {
  "2001": { id: 1, name: "Line A Supervisor", role: "supervisor", line: "Line A" },
  "9000": { id: 2, name: "Floor Admin", role: "admin", line: null },
};

export const DEMO_LINE_TARGETS: LineTarget[] = [
  { line: "Line A", target_per_hour: 18, target_per_day: 140, updated_at: new Date().toISOString() },
  { line: "Line B", target_per_hour: 20, target_per_day: 160, updated_at: new Date().toISOString() },
  { line: "Line C", target_per_hour: 19, target_per_day: 150, updated_at: new Date().toISOString() },
  { line: "Line D", target_per_hour: 16, target_per_day: 125, updated_at: new Date().toISOString() },
];

export const DEMO_WORKERS: Worker[] = [
  { id: 1, name: "Kasun Perera", line: "Line A", smv: 0.8, daily_target: 140, skill_level: "standard", low_efficiency_count: 1, flagged: false, flagged_at: null, next_entry_allowed_at: null, created_at: new Date().toISOString(), submissions_today: 3, avg_efficiency_today: 72.5, efficiency_category: categorizeEfficiency(72.5) },
  { id: 2, name: "Nadeesha Silva", line: "Line B", smv: 1.0, daily_target: 160, skill_level: "senior", low_efficiency_count: 0, flagged: false, flagged_at: null, next_entry_allowed_at: null, created_at: new Date().toISOString(), submissions_today: 4, avg_efficiency_today: 91.2, efficiency_category: categorizeEfficiency(91.2) },
  { id: 3, name: "Chamara Fernando", line: "Line A", smv: 0.75, daily_target: 130, skill_level: "standard", low_efficiency_count: 1, flagged: true, flagged_at: new Date().toISOString(), next_entry_allowed_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), created_at: new Date().toISOString(), submissions_today: 3, avg_efficiency_today: 41.8, efficiency_category: categorizeEfficiency(41.8) },
  { id: 4, name: "Dilrukshi Jayawardena", line: "Line C", smv: 0.9, daily_target: 150, skill_level: "expert", low_efficiency_count: 0, flagged: false, flagged_at: null, next_entry_allowed_at: null, created_at: new Date().toISOString(), submissions_today: 2, avg_efficiency_today: 95.4, efficiency_category: categorizeEfficiency(95.4) },
  { id: 5, name: "Ruwan Bandara", line: "Line B", smv: 1.1, daily_target: 110, skill_level: "junior", low_efficiency_count: 0, flagged: false, flagged_at: null, next_entry_allowed_at: null, created_at: new Date().toISOString(), submissions_today: 3, avg_efficiency_today: 58.3, efficiency_category: categorizeEfficiency(58.3) },
  { id: 6, name: "Malika Wickramasinghe", line: "Line C", smv: 0.85, daily_target: 145, skill_level: "senior", low_efficiency_count: 0, flagged: false, flagged_at: null, next_entry_allowed_at: null, created_at: new Date().toISOString(), submissions_today: 4, avg_efficiency_today: 88.9, efficiency_category: categorizeEfficiency(88.9) },
  { id: 7, name: "Pradeep Kumara", line: "Line A", smv: 0.8, daily_target: 135, skill_level: "standard", low_efficiency_count: 0, flagged: false, flagged_at: null, next_entry_allowed_at: null, created_at: new Date().toISOString(), submissions_today: 3, avg_efficiency_today: 79.1, efficiency_category: categorizeEfficiency(79.1) },
  { id: 8, name: "Samanthi Rathnayake", line: "Line D", smv: 0.95, daily_target: 125, skill_level: "standard", low_efficiency_count: 0, flagged: false, flagged_at: null, next_entry_allowed_at: null, created_at: new Date().toISOString(), submissions_today: 2, avg_efficiency_today: 68.7, efficiency_category: categorizeEfficiency(68.7) },
];

export const DEMO_LOGS: ProductionLog[] = DEMO_WORKERS.slice(0, 6).map((w, i) => {
  const target = DEMO_LINE_TARGETS.find((t) => t.line === w.line);
  return {
    id: i + 1,
    worker_id: w.id,
    worker_name: w.name,
    line: w.line,
    entry_number: (w.submissions_today ?? 1),
    actual_output: 100 + i * 10,
    smv: w.smv,
    available_minutes: 480,
    efficiency: w.avg_efficiency_today || 75,
    target_efficiency: 100,
    target_per_hour: target?.target_per_hour ?? null,
    target_per_day: target?.target_per_day ?? null,
    variance: (w.avg_efficiency_today || 75) - 100,
    risk_level: (w.avg_efficiency_today || 75) < 60 ? "high" : (w.avg_efficiency_today || 75) < 85 ? "medium" : "low",
    efficiency_category: categorizeEfficiency(w.avg_efficiency_today || 75),
    is_low_efficiency: (w.avg_efficiency_today || 75) < 50,
    is_outlier: false,
    downtime_minutes: 0,
    downtime_reason: null,
    notes: null,
    created_at: new Date(Date.now() - i * 45 * 60 * 1000).toISOString(),
  };
});

export const DEMO_ALERTS: Alert[] = [
  { id: 1, worker_id: 3, worker_name: "Chamara Fernando", worker_line: "Line A", production_id: 3, type: "flagged", severity: "high", message: "Chamara Fernando was flagged: entry #2 came in at 41.8% efficiency, below the 50% floor during their first 3 entries, on Line A.", acknowledged: false, employee_seen: false, created_at: new Date().toISOString() },
  { id: 2, worker_id: 5, worker_name: "Ruwan Bandara", worker_line: "Line B", production_id: 5, type: "risk", severity: "medium", message: "Ruwan Bandara logged 58.3% efficiency (variance -41.7%) on Line B.", acknowledged: false, employee_seen: true, created_at: new Date().toISOString() },
  { id: 3, worker_id: 8, worker_name: "Samanthi Rathnayake", worker_line: "Line D", production_id: 8, type: "risk", severity: "medium", message: "Samanthi Rathnayake logged 68.7% efficiency (variance -31.3%) on Line D.", acknowledged: true, employee_seen: true, created_at: new Date().toISOString() },
];

export const DEMO_DASHBOARD: DashboardSummary = {
  kpis: {
    total_logs_today: 26,
    avg_efficiency: 74.5,
    high_risk_count: 4,
    medium_risk_count: 9,
    low_risk_count: 13,
  },
  hourly_trend: Array.from({ length: 8 }).map((_, i) => ({
    hour: new Date(Date.now() - (7 - i) * 60 * 60 * 1000).toISOString(),
    avg_efficiency: 65 + Math.round(Math.sin(i) * 15 + i * 2),
    submissions: 2 + (i % 4),
  })),
  flagged_workers: DEMO_WORKERS.filter((w) => w.flagged).map((w) => ({
    id: w.id,
    name: w.name,
    line: w.line,
    low_efficiency_count: w.low_efficiency_count,
    flagged_at: w.flagged_at,
  })),
  risk_workers: DEMO_WORKERS.filter((w) => w.efficiency_category === "risk").map((w) => ({
    id: w.id,
    name: w.name,
    line: w.line,
    avg_efficiency_today: w.avg_efficiency_today ?? 0,
    flagged: w.flagged,
  })),
  recent_logs: DEMO_LOGS,
};
