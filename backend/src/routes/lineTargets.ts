import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getIo } from "../socket";
import { requireSupervisor } from "../middleware/auth";

export const lineTargetsRouter = Router();

/**
 * GET /api/line-targets
 * Public read — the Submit Log page needs this to show each employee
 * their line's target per hour / per day.
 */
lineTargetsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM line_targets ORDER BY line`);
    return res.json(result.rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/line-targets]", err);
    return res.status(500).json({ error: "Failed to fetch line targets" });
  }
});

/**
 * PUT /api/line-targets/:line
 * Supervisor-only. Sets (or updates) the shared hourly/daily target for
 * every employee on that line.
 */
lineTargetsRouter.put("/:line", requireSupervisor, async (req: Request, res: Response) => {
  try {
    const { line } = req.params;
    const { target_per_hour, target_per_day } = req.body;

    if (target_per_hour === undefined || target_per_day === undefined) {
      return res.status(400).json({ error: "target_per_hour and target_per_day are required" });
    }

    const result = await pool.query(
      `INSERT INTO line_targets (line, target_per_hour, target_per_day, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (line) DO UPDATE
         SET target_per_hour = EXCLUDED.target_per_hour,
             target_per_day = EXCLUDED.target_per_day,
             updated_at = now()
       RETURNING *`,
      [line, target_per_hour, target_per_day]
    );

    getIo().emit("line-target:update", result.rows[0]);
    return res.json(result.rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[PUT /api/line-targets/:line]", err);
    return res.status(500).json({ error: "Failed to update line target" });
  }
});
