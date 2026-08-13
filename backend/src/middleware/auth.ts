import { Request, Response, NextFunction } from "express";
import { verifyToken, TokenPayload, EmployeeTokenPayload, SupervisorTokenPayload } from "../utils/auth";

// Augment Express's Request with the decoded session, set by requireAuth.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/**
 * Verifies the bearer token (employee OR supervisor) and attaches the
 * decoded payload to req.auth. Does not itself restrict by role — use
 * requireSupervisor / requireEmployee for that.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Login required." });
  }
  try {
    req.auth = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
  }
}

/**
 * Restricts a route to a logged-in employee, submitting only under their
 * own identity (individual employee login, per-line binding).
 */
export function requireEmployee(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.auth?.type !== "employee") {
      return res.status(403).json({ error: "This action requires an employee login." });
    }
    return next();
  });
}

/**
 * Restricts a route to a logged-in supervisor or admin. This is the
 * gate for role-based-access actions: acknowledging alerts and clearing
 * a worker's flag.
 */
export function requireSupervisor(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.auth?.type !== "supervisor") {
      return res.status(403).json({ error: "Only an authorized supervisor can perform this action." });
    }
    return next();
  });
}

export function asEmployee(req: Request): EmployeeTokenPayload {
  return req.auth as EmployeeTokenPayload;
}

export function asSupervisor(req: Request): SupervisorTokenPayload {
  return req.auth as SupervisorTokenPayload;
}
