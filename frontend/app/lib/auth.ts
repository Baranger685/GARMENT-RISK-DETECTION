"use client";

// Lightweight PIN-session storage for employees and supervisors.
// Sessions live in localStorage so a login survives a page refresh but
// is scoped to this browser/device — appropriate for a shared factory-
// floor terminal where someone logs in, submits, then logs out.

const EMPLOYEE_KEY = "gr_employee_session";
const SUPERVISOR_KEY = "gr_supervisor_session";

export interface EmployeeSession {
  token: string;
  employee: {
    id: number;
    name: string;
    line: string;
    flagged: boolean;
    next_entry_allowed_at: string | null;
  };
}

export interface SupervisorSession {
  token: string;
  supervisor: {
    id: number;
    name: string;
    role: "supervisor" | "admin";
    line: string | null;
  };
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function clearKey(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

export const employeeAuth = {
  get: () => readJson<EmployeeSession>(EMPLOYEE_KEY),
  set: (session: EmployeeSession) => writeJson(EMPLOYEE_KEY, session),
  clear: () => clearKey(EMPLOYEE_KEY),
};

export const supervisorAuth = {
  get: () => readJson<SupervisorSession>(SUPERVISOR_KEY),
  set: (session: SupervisorSession) => writeJson(SUPERVISOR_KEY, session),
  clear: () => clearKey(SUPERVISOR_KEY),
};
