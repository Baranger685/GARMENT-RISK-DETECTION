"use client";

import { useEffect, useState } from "react";
import { api, ApiUnavailableError, ApiAuthError } from "../lib/api";
import { DEMO_ALERTS, DEMO_SUPERVISOR_PINS } from "../lib/demoData";
import { useSocket } from "../lib/socket";
import { Alert } from "../lib/types";
import { PinLoginCard } from "../components/PinLoginCard";
import { supervisorAuth, SupervisorSession } from "../lib/auth";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState<"all" | "unacknowledged">("unacknowledged");
  const [demoMode, setDemoMode] = useState(false);
  const [supervisor, setSupervisor] = useState<SupervisorSession | null>(null);
  const [showSupervisorLogin, setShowSupervisorLogin] = useState(false);
  const [pendingAckId, setPendingAckId] = useState<number | null>(null);
  const { socket } = useSocket();

  async function load() {
    try {
      const data = await api.getAlerts();
      setAlerts(data);
      setDemoMode(false);
    } catch (err) {
      if (err instanceof ApiUnavailableError) {
        setAlerts(DEMO_ALERTS);
        setDemoMode(true);
      }
    }
  }

  useEffect(() => {
    load();
    setSupervisor(supervisorAuth.get());
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onNew = (alert: Alert) => setAlerts((prev) => [alert, ...prev]);
    const onAck = ({ alertId }: { alertId: number }) =>
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a)));
    socket.on("alert:new", onNew);
    socket.on("alert:acknowledged", onAck);
    return () => {
      socket.off("alert:new", onNew);
      socket.off("alert:acknowledged", onAck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  async function handleSupervisorLogin(pin: string) {
    try {
      const data = await api.supervisorLogin(pin);
      supervisorAuth.set(data);
      setSupervisor(data);
    } catch (err) {
      if (err instanceof ApiUnavailableError) {
        const match = DEMO_SUPERVISOR_PINS[pin];
        if (!match) throw new Error("Incorrect PIN.");
        const demoSession: SupervisorSession = { token: "demo", supervisor: match };
        supervisorAuth.set(demoSession);
        setSupervisor(demoSession);
        return;
      }
      throw err;
    }
    setShowSupervisorLogin(false);
    if (pendingAckId !== null) {
      const id = pendingAckId;
      setPendingAckId(null);
      acknowledge(id);
    }
  }

  function handleSupervisorLogout() {
    supervisorAuth.clear();
    setSupervisor(null);
  }

  async function acknowledge(id: number) {
    if (!supervisor) {
      setPendingAckId(id);
      setShowSupervisorLogin(true);
      return;
    }

    if (demoMode) {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
      return;
    }
    try {
      await api.acknowledgeAlert(id);
    } catch (err) {
      if (err instanceof ApiAuthError && (err.status === 401 || err.status === 403)) {
        supervisorAuth.clear();
        setSupervisor(null);
        setPendingAckId(id);
        setShowSupervisorLogin(true);
      }
    }
  }

  const visible = filter === "all" ? alerts : alerts.filter((a) => !a.acknowledged);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Alerts</h1>
          <p className="text-sm text-slate-500">{alerts.filter((a) => !a.acknowledged).length} unacknowledged</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-2">
            <FilterButton active={filter === "unacknowledged"} onClick={() => setFilter("unacknowledged")}>
              Unacknowledged
            </FilterButton>
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
              All
            </FilterButton>
          </div>

          {supervisor ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">
                Supervisor: <span className="font-medium text-slate-800">{supervisor.supervisor.name}</span>
              </span>
              <button
                onClick={handleSupervisorLogout}
                className="border border-slate-300 hover:bg-slate-50 rounded-lg px-3 py-1.5 font-medium transition"
              >
                Log Out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSupervisorLogin(true)}
              className="text-sm border border-slate-300 hover:bg-slate-50 rounded-lg px-3 py-2 font-medium transition"
            >
              Supervisor Login
            </button>
          )}
        </div>
      </div>

      {showSupervisorLogin && !supervisor && (
        <div className="flex items-start gap-3">
          <PinLoginCard
            title="Supervisor Login"
            description="Only an authorized supervisor or line admin can acknowledge alerts."
            onSubmit={handleSupervisorLogin}
          />
          <button
            onClick={() => {
              setShowSupervisorLogin(false);
              setPendingAckId(null);
            }}
            className="text-sm text-slate-400 hover:text-slate-600 mt-1"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="space-y-3">
        {visible.length === 0 && <p className="text-sm text-slate-400">No alerts to show.</p>}
        {visible.map((a) => (
          <div key={a.id} className={`card flex items-start justify-between gap-4 ${a.acknowledged ? "opacity-60" : ""}`}>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={`badge badge-${a.severity}`}>{a.severity}</span>
                <span className="text-xs uppercase tracking-wide text-slate-400 font-medium">{a.type}</span>
                {a.worker_line && <span className="text-xs text-slate-400">· {a.worker_line}</span>}
              </div>
              <p className="text-sm text-slate-800">{a.message}</p>
              <p className="text-xs text-slate-400 mt-1">{new Date(a.created_at).toLocaleString()}</p>
            </div>
            {!a.acknowledged && (
              <button
                onClick={() => acknowledge(a.id)}
                className="shrink-0 text-sm border border-slate-300 hover:bg-slate-50 rounded-lg px-3 py-1.5 font-medium transition"
              >
                {supervisor ? "Acknowledge" : "Acknowledge (Login Required)"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm rounded-lg px-3 py-1.5 font-medium transition ${
        active ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
