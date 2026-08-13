"use client";

import { useEffect, useState } from "react";
import { api, ApiUnavailableError, ApiAuthError } from "../lib/api";
import { DEMO_WORKERS, DEMO_SUPERVISOR_PINS } from "../lib/demoData";
import { FlaggedBadge, EfficiencyCategoryBadge } from "../components/RiskBadge";
import { PinLoginCard } from "../components/PinLoginCard";
import { Worker, EfficiencyCategory } from "../lib/types";
import { useSocket } from "../lib/socket";
import { supervisorAuth, SupervisorSession } from "../lib/auth";

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [lineFilter, setLineFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | EfficiencyCategory>("all");
  const [supervisor, setSupervisor] = useState<SupervisorSession | null>(null);
  const [showSupervisorLogin, setShowSupervisorLogin] = useState(false);
  const [pendingClearId, setPendingClearId] = useState<number | null>(null);
  const { socket } = useSocket();

  async function load() {
    try {
      const data = await api.getWorkers();
      setWorkers(data);
      setDemoMode(false);
    } catch (err) {
      if (err instanceof ApiUnavailableError) {
        setWorkers(DEMO_WORKERS);
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
    const onWorkerUpdate = () => load();
    socket.on("worker:update", onWorkerUpdate);
    return () => {
      socket.off("worker:update", onWorkerUpdate);
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
    // Retry clearing whichever worker's flag triggered the login prompt.
    if (pendingClearId !== null) {
      const id = pendingClearId;
      setPendingClearId(null);
      clearFlag(id);
    }
  }

  function handleSupervisorLogout() {
    supervisorAuth.clear();
    setSupervisor(null);
  }

  async function clearFlag(id: number) {
    if (!supervisor) {
      setPendingClearId(id);
      setShowSupervisorLogin(true);
      return;
    }

    if (demoMode) {
      setWorkers((prev) =>
        prev.map((w) => (w.id === id ? { ...w, flagged: false, low_efficiency_count: 0 } : w))
      );
      return;
    }
    try {
      await api.clearFlag(id);
      load();
    } catch (err) {
      if (err instanceof ApiAuthError && (err.status === 401 || err.status === 403)) {
        // Session expired or was never valid for this action — prompt again.
        supervisorAuth.clear();
        setSupervisor(null);
        setPendingClearId(id);
        setShowSupervisorLogin(true);
      }
    }
  }

  const lines = Array.from(new Set(workers.map((w) => w.line))).sort();
  const filtered = workers.filter((w) => {
    if (lineFilter !== "all" && w.line !== lineFilter) return false;
    if (categoryFilter !== "all" && w.efficiency_category !== categoryFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Workers</h1>
          <p className="text-sm text-slate-500">
            {workers.filter((w) => w.flagged).length} flagged of {workers.length} total
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All lines</option>
            {lines.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as "all" | EfficiencyCategory)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All efficiency</option>
            <option value="high">High efficiency</option>
            <option value="medium">Medium efficiency</option>
            <option value="risk">Risk</option>
          </select>

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
            description="Only an authorized supervisor or line admin can clear a worker's flag."
            onSubmit={handleSupervisorLogin}
          />
          <button
            onClick={() => {
              setShowSupervisorLogin(false);
              setPendingClearId(null);
            }}
            className="text-sm text-slate-400 hover:text-slate-600 mt-1"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((w) => (
          <div
            key={w.id}
            className={`card ${w.flagged ? "border-red-300 bg-red-50/40" : ""}`}
          >
            <div className="flex items-start justify-between mb-2 gap-2">
              <div>
                <p className="font-semibold text-slate-900">{w.name}</p>
                <p className="text-xs text-slate-500">{w.line} · {w.skill_level}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {w.efficiency_category && <EfficiencyCategoryBadge category={w.efficiency_category} />}
                {w.flagged && <FlaggedBadge />}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm mt-3">
              <div>
                <p className="text-slate-400 text-xs">SMV</p>
                <p className="font-medium">{w.smv}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Daily Target</p>
                <p className="font-medium">{w.daily_target}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Avg Efficiency Today</p>
                <p className="font-medium">{w.avg_efficiency_today ?? "—"}%</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Low-Eff. (first 3 entries)</p>
                <p className={`font-medium ${w.low_efficiency_count >= 2 ? "text-red-600" : ""}`}>
                  {w.low_efficiency_count}/3
                </p>
              </div>
            </div>

            {w.flagged && (
              <button
                onClick={() => clearFlag(w.id)}
                className="mt-4 w-full text-sm border border-red-300 text-red-700 hover:bg-red-100 rounded-lg py-1.5 font-medium transition"
              >
                {supervisor ? "Clear Flag" : "Clear Flag (Supervisor Login Required)"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
