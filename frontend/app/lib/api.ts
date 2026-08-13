import { employeeAuth, supervisorAuth } from "./auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export class ApiUnavailableError extends Error {}
export class ApiAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type AuthMode = "none" | "employee" | "supervisor";

async function request<T>(path: string, init?: RequestInit, auth: AuthMode = "none"): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as any) };

  if (auth === "employee") {
    const session = employeeAuth.get();
    if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;
  } else if (auth === "supervisor") {
    const session = supervisorAuth.get();
    if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiUnavailableError((err as Error).message);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // 401/403/429 are meaningful auth/rate-limit responses, not a "backend is
    // down" condition — surface them distinctly so the UI can react (e.g.
    // show the login form again, or the lock countdown) instead of quietly
    // falling back to demo mode.
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      throw new ApiAuthError(body.error || `Request failed: ${res.status}`, res.status);
    }
    throw new ApiUnavailableError(body.error || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  // --- Auth -----------------------------------------------------------
  employeeLogin: (pin: string) =>
    request<{ token: string; employee: any }>("/api/auth/employee-login", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  supervisorLogin: (pin: string) =>
    request<{ token: string; supervisor: any }>("/api/auth/supervisor-login", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),

  // --- Workers ----------------------------------------------------------
  getWorkers: (category?: string) => {
    const qs = category ? `?category=${category}` : "";
    return request<any[]>(`/api/workers${qs}`);
  },
  getWorker: (id: number | string) => request<any>(`/api/workers/${id}`),
  getWorkerTrend: (id: number | string) => request<any[]>(`/api/workers/${id}/efficiency-trend`),
  getMyProfile: () => request<any>("/api/workers/me", undefined, "employee"),
  markMyNotificationsSeen: () =>
    request<any>("/api/workers/me/notifications/seen", { method: "PATCH" }, "employee"),
  clearFlag: (id: number | string) =>
    request<any>(`/api/workers/${id}/clear-flag`, { method: "PATCH" }, "supervisor"),

  // --- Line targets -------------------------------------------------------
  getLineTargets: () => request<any[]>("/api/line-targets"),
  setLineTarget: (line: string, target_per_hour: number, target_per_day: number) =>
    request<any>(
      `/api/line-targets/${encodeURIComponent(line)}`,
      { method: "PUT", body: JSON.stringify({ target_per_hour, target_per_day }) },
      "supervisor"
    ),

  // --- Production ---------------------------------------------------------
  getDashboardSummary: () => request<any>("/api/production/dashboard-summary"),
  getProductionLogs: (params?: Record<string, string | number>) => {
    const qs = params ? "?" + new URLSearchParams(params as any).toString() : "";
    return request<any[]>(`/api/production${qs}`);
  },
  submitProduction: (payload: Record<string, unknown>) =>
    request<any>("/api/production", { method: "POST", body: JSON.stringify(payload) }, "employee"),

  // --- Alerts -----------------------------------------------------------
  getAlerts: (params?: Record<string, string | number>) => {
    const qs = params ? "?" + new URLSearchParams(params as any).toString() : "";
    return request<any[]>(`/api/alerts${qs}`);
  },
  getAlertStats: () => request<any>("/api/alerts/stats"),
  acknowledgeAlert: (id: number | string) =>
    request<any>(`/api/alerts/${id}/acknowledge`, { method: "PATCH" }, "supervisor"),
  logDowntime: (payload: Record<string, unknown>) =>
    request<any>("/api/alerts/downtime", { method: "POST", body: JSON.stringify(payload) }),
  getDowntimeStats: () => request<any[]>("/api/alerts/downtime/stats"),
};
