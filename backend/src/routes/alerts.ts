import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getIo } from "../socket";
import { requireSupervisor } from "../middleware/auth";

export const alertsRouter = Router();

/**
 * GET /api/alerts
 */
alertsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { acknowledged, limit = 100 } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];

    if (acknowledged !== undefined) {
      params.push(acknowledged === "true");
      conditions.push(`a.acknowledged = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(Number(limit));

    const result = await pool.query(
      `SELECT a.*, w.name AS worker_name, w.line AS worker_line
       FROM alerts a
       LEFT JOIN workers w ON w.id = a.worker_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return res.json(result.rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/alerts]", err);
    return res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

/**
 * GET /api/alerts/stats
 */
alertsRouter.get("/stats", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE NOT acknowledged)::int AS unacknowledged,
        COUNT(*) FILTER (WHERE severity = 'high')::int AS high,
        COUNT(*) FILTER (WHERE severity = 'medium')::int AS medium,
        COUNT(*) FILTER (WHERE severity = 'low')::int AS low,
        COUNT(*) FILTER (WHERE type = 'flagged')::int AS flagged_count
      FROM alerts
    `);
    return res.json(result.rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/alerts/stats]", err);
    return res.status(500).json({ error: "Failed to fetch alert stats" });
  }
});

/**
 * PATCH /api/alerts/:id/acknowledge
 * Supervisor-only (role-based access control) — only an authorized
 * supervisor or line admin can acknowledge an alert.
 */
alertsRouter.patch("/:id/acknowledge", requireSupervisor, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE alerts SET acknowledged = TRUE WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Alert not found" });
    getIo().emit("alert:acknowledged", { alertId: Number(req.params.id) });
    return res.json(result.rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[PATCH /api/alerts/:id/acknowledge]", err);
    return res.status(500).json({ error: "Failed to acknowledge alert" });
  }
});

/**
 * POST /api/alerts/downtime
 * Logs a downtime event and raises a medium-severity alert.
 */
alertsRouter.post("/downtime", async (req: Request, res: Response) => {
  try {
    const { worker_id, line, minutes, reason } = req.body;
    if (!minutes || !reason) {
      return res.status(400).json({ error: "minutes and reason are required" });
    }

    let resolvedLine = line;
    if (!resolvedLine && worker_id) {
      const w = await pool.query("SELECT line FROM workers WHERE id = $1", [worker_id]);
      resolvedLine = w.rows[0]?.line ?? null;
    }

    const alertResult = await pool.query(
      `INSERT INTO alerts (worker_id, type, severity, message)
       VALUES ($1, 'downtime', 'medium', $2) RETURNING *`,
      [worker_id ?? null, `Downtime logged on ${resolvedLine ?? "unknown line"}: ${minutes} min — ${reason}`]
    );

    getIo().emit("alert:new", alertResult.rows[0]);
    return res.status(201).json(alertResult.rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/alerts/downtime]", err);
    return res.status(500).json({ error: "Failed to log downtime" });
  }
});

/**
 * GET /api/alerts/downtime/stats
 * Downtime breakdown by reason, derived from production_logs.downtime_minutes.
 */
alertsRouter.get("/downtime/stats", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(downtime_reason, 'Unspecified') AS reason,
        SUM(downtime_minutes)::int AS total_minutes,
        COUNT(*)::int AS occurrences
      FROM production_logs
      WHERE downtime_minutes > 0
      GROUP BY reason
      ORDER BY total_minutes DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/alerts/downtime/stats]", err);
    return res.status(500).json({ error: "Failed to fetch downtime stats" });
  }
});
