"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { api, ApiUnavailableError } from "../lib/api";
import { DEMO_DASHBOARD } from "../lib/demoData";
import { useSocket } from "../lib/socket";
import { RiskBadge } from "../components/RiskBadge";
import { DashboardSummary, ProductionLog, Alert as AlertT } from "../lib/types";

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [liveAlerts, setLiveAlerts] = useState<AlertT[]>([]);
  const { socket } = useSocket();

  async function load() {
    try {
      const data = await api.getDashboardSummary();
      setSummary(data);
      setDemoMode(false);
    } catch (err) {
      if (err instanceof ApiUnavailableError) {
        setSummary(DEMO_DASHBOARD);
        setDemoMode(true);
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = (_log: ProductionLog) => load();
    const onWorkerUpdate = () => load();
    const onAlert = (alert: AlertT) => setLiveAlerts((prev) => [alert, ...prev].slice(0, 5));

    socket.on("dashboard:update", onUpdate);
    socket.on("worker:update", onWorkerUpdate);
    socket.on("alert:new", onAlert);
    return () => {
      socket.off("dashboard:update", onUpdate);
      socket.off("worker:update", onWorkerUpdate);
      socket.off("alert:new", onAlert);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  if (!summary) {
    return <p className="text-slate-500">Loading dashboard…</p>;
  }

  const { kpis, hourly_trend, flagged_workers, risk_workers, recent_logs } = summary;

  const flaggedByLine = flagged_workers.reduce<Record<string, typeof flagged_workers>>((acc, w) => {
    acc[w.line] = acc[w.line] || [];
    acc[w.line].push(w);
    return acc;
  }, {});

  const riskByLine = risk_workers.reduce<Record<string, typeof risk_workers>>((acc, w) => {
    acc[w.line] = acc[w.line] || [];
    acc[w.line].push(w);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Live production KPIs across all lines</p>
        </div>
        {demoMode && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
            Demo mode — backend not detected
          </span>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Logs Today" value={kpis.total_logs_today} />
        <KpiCard label="Avg Efficiency" value={`${kpis.avg_efficiency}%`} />
        <KpiCard label="Medium Risk" value={kpis.medium_risk_count} accent="text-amber-600" />
        <KpiCard label="High Risk" value={kpis.high_risk_count} accent="text-red-600" />
      </div>

      {/* Flagged workers, grouped by line */}
      {flagged_workers.length > 0 && (
        <div className="card border-red-200 bg-red-50/40">
          <h2 className="font-bold text-red-700 mb-3">⚑ Flagged Workers — by Production Line</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(flaggedByLine).map(([line, list]) => (
              <div key={line} className="bg-white rounded-lg border border-red-200 p-4">
                <p className="text-sm font-semibold text-slate-700 mb-2">{line}</p>
                <ul className="space-y-2">
                  {list.map((w) => (
                    <li key={w.id} className="flex items-center justify-between text-sm">
                      <Link href={`/workers`} className="text-slate-800 hover:underline">
                        {w.name}
                      </Link>
                      <span className="text-xs text-red-600 font-medium">
                        {w.low_efficiency_count} strikes
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risk-category employees, grouped by line — separate supervisor /
          line-admin panel from the flagged-workers list above. A worker
          can show up here (avg efficiency today < 50%) without necessarily
          being formally flagged yet. */}
      {risk_workers.length > 0 && (
        <div className="card border-amber-200 bg-amber-50/40">
          <h2 className="font-bold text-amber-700 mb-3">⚠ Risk-Category Employees — by Production Line</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(riskByLine).map(([line, list]) => (
              <div key={line} className="bg-white rounded-lg border border-amber-200 p-4">
                <p className="text-sm font-semibold text-slate-700 mb-2">{line}</p>
                <ul className="space-y-2">
                  {list.map((w) => (
                    <li key={w.id} className="flex items-center justify-between text-sm">
                      <Link href={`/workers`} className="text-slate-800 hover:underline">
                        {w.name}
                        {w.flagged && <span className="ml-1 text-red-500">⚑</span>}
                      </Link>
                      <span className="text-xs text-amber-700 font-medium">
                        {w.avg_efficiency_today}% avg
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hourly chart */}
      <div className="card">
        <h2 className="font-semibold text-slate-800 mb-4">Hourly Efficiency Trend</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={hourly_trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="hour"
              tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit" })}
              tick={{ fontSize: 12 }}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip labelFormatter={(v) => new Date(v).toLocaleString()} />
            <Line type="monotone" dataKey="avg_efficiency" stroke="#dc2626" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent logs */}
        <div className="card">
          <h2 className="font-semibold text-slate-800 mb-3">Recent Submissions</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recent_logs.map((log) => (
              <div key={log.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2">
                <div>
                  <p className="font-medium text-slate-800">{log.worker_name}</p>
                  <p className="text-xs text-slate-500">{log.line} · {new Date(log.created_at).toLocaleTimeString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{log.efficiency}%</p>
                  <RiskBadge level={log.risk_level} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live alert feed */}
        <div className="card">
          <h2 className="font-semibold text-slate-800 mb-3">Live Alert Feed</h2>
          {liveAlerts.length === 0 ? (
            <p className="text-sm text-slate-400">Waiting for new alerts…</p>
          ) : (
            <div className="space-y-2">
              {liveAlerts.map((a) => (
                <div key={a.id} className="text-sm border-b border-slate-100 pb-2">
                  <span className={`badge badge-${a.severity} mr-2`}>{a.type}</span>
                  {a.message}
                </div>
              ))}
            </div>
          )}
          <Link href="/alerts" className="text-sm text-red-600 font-medium mt-3 inline-block">
            View all alerts →
          </Link>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="card">
      <p className={`text-2xl font-bold ${accent || "text-slate-900"}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
}
