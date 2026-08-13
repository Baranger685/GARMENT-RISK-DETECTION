import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getIo } from "../socket";
import { getPrediction } from "../utils/mlClient";
import { requireEmployee, asEmployee } from "../middleware/auth";
import { categorizeEfficiency, RISK_EFFICIENCY_THRESHOLD } from "../utils/efficiencyCategory";

export const productionRouter = Router();

// New probation-period flagging rule (replaces the old all-time rolling
// strike system): only an employee's first 3 ever entries are checked.
// If any one of those first 3 entries comes in below 50% efficiency, the
// employee is flagged immediately, notified on their own dashboard, and
// every submission after that point (starting with what would be their
// 4th entry) is blocked until a supervisor clears the flag.
const PROBATION_ENTRY_WINDOW = 3;

// Server-enforced minimum gap between two submissions from the same
// employee. The Submit Log page's on-screen countdown is a fast 20s UX
// animation, but this is the real, backend-enforced rate limit.
const ENTRY_LOCK_MS = 60 * 60 * 1000; // 1 hour

/**
 * POST /api/production
 * Submit a production log. Requires an employee login (individual PIN),
 * and the worker is always resolved from the authenticated session —
 * never trusted from the request body — so submissions can't be filed
 * under someone else's name.
 */
productionRouter.post("/", requireEmployee, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const employee = asEmployee(req);
    const {
      actual_output,
      available_minutes = 480,
      target_efficiency = 100,
      downtime_minutes = 0,
      downtime_reason = null,
      notes = null,
    } = req.body;

    if (actual_output === undefined) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(400).json({ error: "actual_output is required" });
    }

    await client.query("BEGIN");

    const workerResult = await client.query(
      "SELECT * FROM workers WHERE id = $1 FOR UPDATE",
      [employee.workerId]
    );
    if (workerResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Worker not found" });
    }
    const worker = workerResult.rows[0];

    // --- Role-based blocks -------------------------------------------
    if (worker.flagged) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Your account is flagged for low efficiency. A supervisor must clear the flag before you can submit again.",
        flagged: true,
      });
    }

    if (worker.next_entry_allowed_at && new Date(worker.next_entry_allowed_at) > new Date()) {
      await client.query("ROLLBACK");
      return res.status(429).json({
        error: "You've already submitted an entry recently. Please wait for the next hourly window.",
        next_entry_allowed_at: worker.next_entry_allowed_at,
      });
    }

    // How many entries has this worker ever submitted? Determines both
    // the entry_number for this submission and whether it still falls
    // inside the 3-entry probation window.
    const countResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM production_logs WHERE worker_id = $1",
      [employee.workerId]
    );
    const entryNumber = countResult.rows[0].count + 1;

    // Resolve this worker's line target (manually set per-line by a supervisor).
    const targetResult = await client.query(
      "SELECT target_per_hour, target_per_day FROM line_targets WHERE line = $1",
      [worker.line]
    );
    const lineTarget = targetResult.rows[0] || null;

    // Historical average efficiency for this worker, still used by the ML
    // service's outlier check (statistical, informational only — it no
    // longer drives the flagging decision, which is the 50%-in-first-3 rule).
    const historyResult = await client.query(
      `SELECT efficiency FROM production_logs
       WHERE worker_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [employee.workerId]
    );
    const historyValues: number[] = historyResult.rows.map((r) => Number(r.efficiency));
    const workerHistoryAvg =
      historyValues.length > 0
        ? historyValues.reduce((a, b) => a + b, 0) / historyValues.length
        : null;

    const prediction = await getPrediction({
      actual_output: Number(actual_output),
      smv: Number(worker.smv),
      available_minutes: Number(available_minutes),
      target_efficiency: Number(target_efficiency),
      worker_history_avg: workerHistoryAvg,
      history: historyValues,
    });

    const efficiencyCategory = categorizeEfficiency(prediction.efficiency);

    const insertResult = await client.query(
      `INSERT INTO production_logs
        (worker_id, line, entry_number, actual_output, smv, available_minutes, efficiency,
         target_efficiency, target_per_hour, target_per_day, variance, risk_level,
         efficiency_category, is_low_efficiency, is_outlier,
         downtime_minutes, downtime_reason, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        employee.workerId,
        worker.line,
        entryNumber,
        actual_output,
        worker.smv,
        available_minutes,
        prediction.efficiency,
        prediction.target_efficiency,
        lineTarget?.target_per_hour ?? null,
        lineTarget?.target_per_day ?? null,
        prediction.variance,
        prediction.risk_level,
        efficiencyCategory,
        prediction.is_low_efficiency,
        prediction.is_outlier,
        downtime_minutes,
        downtime_reason,
        notes,
      ]
    );
    const log = insertResult.rows[0];

    // --- First-3-entries probation flagging rule ------------------------
    let newLowCount = worker.low_efficiency_count;
    let justFlagged = false;
    const isProbationEntry = entryNumber <= PROBATION_ENTRY_WINDOW;
    const isBelowFloor = prediction.efficiency < RISK_EFFICIENCY_THRESHOLD;

    if (isProbationEntry && isBelowFloor) {
      newLowCount += 1;
      justFlagged = !worker.flagged; // first time this happens for this worker

      await client.query(
        `UPDATE workers
         SET low_efficiency_count = $1,
             flagged = TRUE,
             flagged_at = now(),
             next_entry_allowed_at = $2
         WHERE id = $3`,
        [newLowCount, new Date(Date.now() + ENTRY_LOCK_MS).toISOString(), employee.workerId]
      );
    } else {
      await client.query(
        `UPDATE workers SET next_entry_allowed_at = $1 WHERE id = $2`,
        [new Date(Date.now() + ENTRY_LOCK_MS).toISOString(), employee.workerId]
      );
    }

    // --- Alerts -----------------------------------------------------------
    if (prediction.risk_level !== "low") {
      const alertResult = await client.query(
        `INSERT INTO alerts (worker_id, production_id, type, severity, message)
         VALUES ($1,$2,'risk',$3,$4) RETURNING *`,
        [
          employee.workerId,
          log.id,
          prediction.risk_level,
          `${worker.name} logged ${prediction.efficiency}% efficiency (variance ${prediction.variance}%) on ${worker.line}.`,
        ]
      );
      getIo().emit("alert:new", alertResult.rows[0]);
    }

    if (justFlagged) {
      const flagAlertResult = await client.query(
        `INSERT INTO alerts (worker_id, production_id, type, severity, message)
         VALUES ($1,$2,'flagged','high',$3) RETURNING *`,
        [
          employee.workerId,
          log.id,
          `${worker.name} was flagged: entry #${entryNumber} came in at ${prediction.efficiency}% efficiency, below the 50% floor during their first ${PROBATION_ENTRY_WINDOW} entries, on ${worker.line}.`,
        ]
      );
      // Supervisor-facing alert feed.
      getIo().emit("alert:new", flagAlertResult.rows[0]);
      // Employee-facing notification on their own dashboard.
      getIo().to(`employee:${employee.workerId}`).emit("employee:notification", flagAlertResult.rows[0]);
    }

    await client.query("COMMIT");

    const updatedWorkerResult = await pool.query("SELECT * FROM workers WHERE id = $1", [employee.workerId]);
    const updatedWorker = updatedWorkerResult.rows[0];

    // --- Realtime broadcasts --------------------------------------------
    getIo().to(`line:${worker.line}`).emit("dashboard:update", log);
    getIo().emit("dashboard:update", log);
    getIo().emit("worker:update", updatedWorker);

    return res.status(201).json({
      log,
      worker: updatedWorker,
      flagged_this_submission: justFlagged,
      entry_number: entryNumber,
      low_efficiency_count: newLowCount,
      next_entry_allowed_at: updatedWorker.next_entry_allowed_at,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    // eslint-disable-next-line no-console
    console.error("[POST /api/production]", err);
    return res.status(500).json({ error: "Failed to submit production log" });
  } finally {
    client.release();
  }
});

/**
 * GET /api/production
 * List recent production logs, optionally filtered by worker_id or line.
 */
productionRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { worker_id, line, limit = 100 } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];

    if (worker_id) {
      params.push(worker_id);
      conditions.push(`worker_id = $${params.length}`);
    }
    if (line) {
      params.push(line);
      conditions.push(`line = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(Number(limit));

    const result = await pool.query(
      `SELECT pl.*, w.name AS worker_name
       FROM production_logs pl
       JOIN workers w ON w.id = pl.worker_id
       ${where}
       ORDER BY pl.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json(result.rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/production]", err);
    return res.status(500).json({ error: "Failed to fetch production logs" });
  }
});

/**
 * GET /api/production/dashboard-summary
 * Aggregated KPIs for the dashboard: avg efficiency, risk breakdown,
 * hourly trend, currently flagged workers (with their line), and
 * currently "Risk" category workers (with their line) for the
 * supervisor / line-admin risk panel.
 */
productionRouter.get("/dashboard-summary", async (_req: Request, res: Response) => {
  try {
    const kpis = await pool.query(`
      SELECT
        COUNT(*)::int                                    AS total_logs_today,
        COALESCE(AVG(efficiency), 0)::numeric(6,2)        AS avg_efficiency,
        COUNT(*) FILTER (WHERE risk_level = 'high')::int  AS high_risk_count,
        COUNT(*) FILTER (WHERE risk_level = 'medium')::int AS medium_risk_count,
        COUNT(*) FILTER (WHERE risk_level = 'low')::int   AS low_risk_count
      FROM production_logs
      WHERE created_at >= CURRENT_DATE
    `);

    const hourly = await pool.query(`
      SELECT date_trunc('hour', created_at) AS hour,
             AVG(efficiency)::numeric(6,2) AS avg_efficiency,
             COUNT(*)::int AS submissions
      FROM production_logs
      WHERE created_at >= CURRENT_DATE
      GROUP BY hour
      ORDER BY hour
    `);

    const flaggedWorkers = await pool.query(`
      SELECT id, name, line, low_efficiency_count, flagged_at
      FROM workers
      WHERE flagged = TRUE
      ORDER BY flagged_at DESC
    `);

    // Employees whose today's average efficiency lands them in the
    // "Risk" category (< 50%), for the dedicated supervisor/line-admin
    // risk panel — independent of whether they've been formally flagged.
    const riskWorkers = await pool.query(`
      SELECT w.id, w.name, w.line,
             ROUND(AVG(pl.efficiency), 2) AS avg_efficiency_today,
             w.flagged
      FROM workers w
      JOIN production_logs pl ON pl.worker_id = w.id AND pl.created_at >= CURRENT_DATE
      GROUP BY w.id, w.name, w.line, w.flagged
      HAVING AVG(pl.efficiency) < 50
      ORDER BY avg_efficiency_today ASC
    `);

    const recentLogs = await pool.query(`
      SELECT pl.*, w.name AS worker_name
      FROM production_logs pl
      JOIN workers w ON w.id = pl.worker_id
      ORDER BY pl.created_at DESC
      LIMIT 15
    `);

    return res.json({
      kpis: kpis.rows[0],
      hourly_trend: hourly.rows,
      flagged_workers: flaggedWorkers.rows,
      risk_workers: riskWorkers.rows,
      recent_logs: recentLogs.rows,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/production/dashboard-summary]", err);
    return res.status(500).json({ error: "Failed to build dashboard summary" });
  }
});
