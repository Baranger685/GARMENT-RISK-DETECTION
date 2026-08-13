import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getIo } from "../socket";
import { requireSupervisor, requireEmployee, asEmployee } from "../middleware/auth";
import { hashPin } from "../utils/auth";
import { HIGH_EFFICIENCY_THRESHOLD, RISK_EFFICIENCY_THRESHOLD } from "../utils/efficiencyCategory";

export const workersRouter = Router();

// Shared SQL fragment: today's stats + a high/medium/risk efficiency
// category derived from today's average efficiency (falls back to
// "medium" for a worker with no submissions yet today).
const WORKERS_WITH_STATS_SQL = `
  SELECT
    w.*,
    COALESCE(t.submissions_today, 0)::int          AS submissions_today,
    COALESCE(t.avg_efficiency_today, 0)::numeric(6,2) AS avg_efficiency_today,
    CASE
      WHEN t.avg_efficiency_today IS NULL THEN 'medium'
      WHEN t.avg_efficiency_today >= ${HIGH_EFFICIENCY_THRESHOLD} THEN 'high'
      WHEN t.avg_efficiency_today >= ${RISK_EFFICIENCY_THRESHOLD} THEN 'medium'
      ELSE 'risk'
    END AS efficiency_category
  FROM workers w
  LEFT JOIN (
    SELECT worker_id,
           COUNT(*) AS submissions_today,
           AVG(efficiency) AS avg_efficiency_today
    FROM production_logs
    WHERE created_at >= CURRENT_DATE
    GROUP BY worker_id
  ) t ON t.worker_id = w.id
`;

/**
 * GET /api/workers
 * All workers plus today's stats and a high/medium/risk efficiency
 * category. Optional ?category=high|medium|risk server-side filter.
 */
workersRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    const validCategories = ["high", "medium", "risk"];

    const result = await pool.query(`${WORKERS_WITH_STATS_SQL} ORDER BY w.line, w.name`);
    // Never leak PIN hashes to the client.
    let sanitized = result.rows.map(({ pin_hash, ...rest }) => rest);

    if (category && validCategories.includes(String(category))) {
      sanitized = sanitized.filter((w) => w.efficiency_category === category);
    }

    return res.json(sanitized);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/workers]", err);
    return res.status(500).json({ error: "Failed to fetch workers" });
  }
});

/**
 * GET /api/workers/me
 * The logged-in employee's own record, current lock status, and any
 * unseen flag notifications — powers the Submit Log page's own-dashboard
 * view after PIN login.
 */
workersRouter.get("/me", requireEmployee, async (req: Request, res: Response) => {
  try {
    const employee = asEmployee(req);
    const workerResult = await pool.query("SELECT * FROM workers WHERE id = $1", [employee.workerId]);
    if (workerResult.rowCount === 0) return res.status(404).json({ error: "Worker not found" });

    const { pin_hash, ...worker } = workerResult.rows[0];

    const notifications = await pool.query(
      `SELECT * FROM alerts
       WHERE worker_id = $1 AND type = 'flagged' AND employee_seen = FALSE
       ORDER BY created_at DESC`,
      [employee.workerId]
    );

    const entryCountResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM production_logs WHERE worker_id = $1",
      [employee.workerId]
    );

    return res.json({
      worker,
      entries_submitted: entryCountResult.rows[0].count,
      unseen_notifications: notifications.rows,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/workers/me]", err);
    return res.status(500).json({ error: "Failed to fetch your profile" });
  }
});

/**
 * PATCH /api/workers/me/notifications/seen
 * Marks the employee's own flag notification(s) as seen so the banner
 * doesn't keep reappearing on every page load.
 */
workersRouter.patch("/me/notifications/seen", requireEmployee, async (req: Request, res: Response) => {
  try {
    const employee = asEmployee(req);
    await pool.query(
      `UPDATE alerts SET employee_seen = TRUE WHERE worker_id = $1 AND type = 'flagged' AND employee_seen = FALSE`,
      [employee.workerId]
    );
    return res.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[PATCH /api/workers/me/notifications/seen]", err);
    return res.status(500).json({ error: "Failed to update notifications" });
  }
});

/**
 * GET /api/workers/:id
 */
workersRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM workers WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Worker not found" });

    const { pin_hash, ...worker } = result.rows[0];

    const recentLogs = await pool.query(
      `SELECT * FROM production_logs WHERE worker_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );
    const recentAlerts = await pool.query(
      `SELECT * FROM alerts WHERE worker_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );

    return res.json({
      worker,
      recent_logs: recentLogs.rows,
      recent_alerts: recentAlerts.rows,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/workers/:id]", err);
    return res.status(500).json({ error: "Failed to fetch worker" });
  }
});

/**
 * GET /api/workers/:id/efficiency-trend
 * Daily average efficiency for the last 7 days.
 */
workersRouter.get("/:id/efficiency-trend", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT date_trunc('day', created_at) AS day,
              AVG(efficiency)::numeric(6,2) AS avg_efficiency,
              COUNT(*)::int AS submissions
       FROM production_logs
       WHERE worker_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY day
       ORDER BY day`,
      [req.params.id]
    );
    return res.json(result.rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/workers/:id/efficiency-trend]", err);
    return res.status(500).json({ error: "Failed to fetch efficiency trend" });
  }
});

/**
 * POST /api/workers
 * Supervisor-only. Creates a worker with a PIN (hashed before storage).
 */
workersRouter.post("/", requireSupervisor, async (req: Request, res: Response) => {
  try {
    const { name, line, smv, daily_target, skill_level = "standard", pin } = req.body;
    if (!name || !line || smv === undefined || daily_target === undefined || !pin) {
      return res.status(400).json({ error: "name, line, smv, daily_target, and pin are required" });
    }
    const pinHash = await hashPin(String(pin));
    const result = await pool.query(
      `INSERT INTO workers (name, line, smv, daily_target, skill_level, pin_hash)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, line, smv, daily_target, skill_level, pinHash]
    );
    const { pin_hash, ...worker } = result.rows[0];
    getIo().emit("worker:update", worker);
    return res.status(201).json(worker);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/workers]", err);
    return res.status(500).json({ error: "Failed to create worker" });
  }
});

/**
 * PATCH /api/workers/:id/clear-flag
 * Supervisor-only (role-based access control). Clears a worker's flag,
 * resets the first-3-entries low-efficiency counter, and lifts the
 * submission block so the employee can submit again.
 */
workersRouter.patch("/:id/clear-flag", requireSupervisor, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE workers
       SET flagged = FALSE, flagged_at = NULL, low_efficiency_count = 0, next_entry_allowed_at = NULL
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Worker not found" });
    const { pin_hash, ...worker } = result.rows[0];
    getIo().emit("worker:update", worker);
    return res.json(worker);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[PATCH /api/workers/:id/clear-flag]", err);
    return res.status(500).json({ error: "Failed to clear flag" });
  }
});
