import { Router, Request, Response } from "express";
import { pool } from "../db";
import { verifyPin, signEmployeeToken, signSupervisorToken } from "../utils/auth";

export const authRouter = Router();

/**
 * POST /api/auth/employee-login
 * Individual employee PIN login. Used on the Submit Log page so every
 * hourly entry is tied to a specific, verified employee rather than a
 * dropdown selection.
 */
authRouter.post("/employee-login", async (req: Request, res: Response) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: "PIN is required." });

    const result = await pool.query(
      `SELECT id, name, line, pin_hash, flagged, next_entry_allowed_at
       FROM workers WHERE pin_hash IS NOT NULL`
    );

    // PINs are hashed, so we check each candidate rather than querying by
    // plaintext PIN. Worker counts are small (factory-floor scale), so
    // this is cheap; for a much larger workforce a lookup table keyed by
    // a fast PIN-index hash would be preferable.
    for (const row of result.rows) {
      const match = await verifyPin(String(pin), row.pin_hash);
      if (match) {
        const token = signEmployeeToken({ workerId: row.id, name: row.name, line: row.line });
        return res.json({
          token,
          employee: {
            id: row.id,
            name: row.name,
            line: row.line,
            flagged: row.flagged,
            next_entry_allowed_at: row.next_entry_allowed_at,
          },
        });
      }
    }

    return res.status(401).json({ error: "Incorrect PIN." });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/auth/employee-login]", err);
    return res.status(500).json({ error: "Login failed." });
  }
});

/**
 * POST /api/auth/supervisor-login
 * Supervisor / line-admin PIN login. Required for acknowledging alerts
 * and clearing worker flags (role-based access control).
 */
authRouter.post("/supervisor-login", async (req: Request, res: Response) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: "PIN is required." });

    const result = await pool.query(`SELECT id, name, role, line, pin_hash FROM supervisors`);

    for (const row of result.rows) {
      const match = await verifyPin(String(pin), row.pin_hash);
      if (match) {
        const token = signSupervisorToken({
          supervisorId: row.id,
          name: row.name,
          role: row.role,
          line: row.line,
        });
        return res.json({
          token,
          supervisor: { id: row.id, name: row.name, role: row.role, line: row.line },
        });
      }
    }

    return res.status(401).json({ error: "Incorrect PIN." });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/auth/supervisor-login]", err);
    return res.status(500).json({ error: "Login failed." });
  }
});
