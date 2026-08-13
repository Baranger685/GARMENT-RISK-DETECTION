import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";

// Employee sessions are short-lived (matches one shift's worth of submissions);
// supervisor sessions live a bit longer since they're used across the floor.
const EMPLOYEE_TOKEN_TTL = "10h";
const SUPERVISOR_TOKEN_TTL = "12h";

export type AuthRole = "employee" | "supervisor" | "admin";

export interface EmployeeTokenPayload {
  type: "employee";
  workerId: number;
  name: string;
  line: string;
}

export interface SupervisorTokenPayload {
  type: "supervisor";
  supervisorId: number;
  name: string;
  role: "supervisor" | "admin";
  line: string | null; // null = all lines
}

export type TokenPayload = EmployeeTokenPayload | SupervisorTokenPayload;

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export function signEmployeeToken(payload: Omit<EmployeeTokenPayload, "type">): string {
  return jwt.sign({ type: "employee", ...payload }, JWT_SECRET, { expiresIn: EMPLOYEE_TOKEN_TTL });
}

export function signSupervisorToken(payload: Omit<SupervisorTokenPayload, "type">): string {
  return jwt.sign({ type: "supervisor", ...payload }, JWT_SECRET, { expiresIn: SUPERVISOR_TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as TokenPayload;
}
