"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { api, ApiUnavailableError } from "../lib/api";
import { DEMO_DASHBOARD } from "../lib/demoData";

const RISK_COLORS = { low: "#16a34a", medium: "#d97706", high: "#dc2626" };

export default function AnalyticsPage() {
  const [kpis, setKpis] = useState(DEMO_DASHBOARD.kpis);
  const [downtime, setDowntime] = useState<{ reason: string; total_minutes: number; occurrences: number }[]>([]);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    api
      .getDashboardSummary()
      .then((data) => {
        setKpis(data.kpis);
        setDemoMode(false);
      })
      .catch((err) => {
        if (err instanceof ApiUnavailableError) {
          setKpis(DEMO_DASHBOARD.kpis);
          setDemoMode(true);
        }
      });

    api
      .getDowntimeStats()
      .then(setDowntime)
      .catch(() =>
        setDowntime([
          { reason: "Machine breakdown", total_minutes: 145, occurrences: 6 },
          { reason: "Material shortage", total_minutes: 90, occurrences: 4 },
          { reason: "Power outage", total_minutes: 60, occurrences: 2 },
          { reason: "Unspecified", total_minutes: 35, occurrences: 3 },
        ])
      );
  }, []);

  const riskData = [
    { name: "Low", value: kpis.low_risk_count, color: RISK_COLORS.low },
    { name: "Medium", value: kpis.medium_risk_count, color: RISK_COLORS.medium },
    { name: "High", value: kpis.high_risk_count, color: RISK_COLORS.high },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <p className="text-sm text-slate-500">Variance, downtime, and risk breakdowns</p>
        {demoMode && (
          <p className="text-xs text-amber-600 mt-2">Demo mode — backend not detected.</p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-semibold text-slate-800 mb-4">Risk Level Breakdown (Today)</h2>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={riskData} dataKey="value" nameKey="name" outerRadius={90} label>
                {riskData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="font-semibold text-slate-800 mb-4">Downtime by Reason (minutes)</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={downtime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="reason" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="total_minutes" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold text-slate-800 mb-2">Variance Classification Reference</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2">Variance %</th>
              <th className="py-2">Risk Level</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2">0 – 10%</td>
              <td className="py-2"><span className="badge badge-low">Low Risk</span></td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2">10 – 25%</td>
              <td className="py-2"><span className="badge badge-medium">Medium Risk</span></td>
            </tr>
            <tr>
              <td className="py-2">&gt; 25%</td>
              <td className="py-2"><span className="badge badge-high">High Risk</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
