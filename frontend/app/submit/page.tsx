"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiUnavailableError, ApiAuthError } from "../lib/api";
import { DEMO_WORKERS, DEMO_EMPLOYEE_PINS, DEMO_LINE_TARGETS } from "../lib/demoData";
import { categorizeEfficiency } from "../lib/efficiency";
import { AnalysisCountdown } from "../components/AnalysisCountdown";
import { RiskBadge, FlaggedBadge, EfficiencyCategoryBadge } from "../components/RiskBadge";
import { PinLoginCard } from "../components/PinLoginCard";
import { Worker, LineTarget } from "../lib/types";
import { employeeAuth, EmployeeSession } from "../lib/auth";

type Stage = "form" | "analyzing" | "result";

interface SubmissionResult {
  efficiency: number;
  variance: number;
  risk_level: "low" | "medium" | "high";
  efficiency_category: "high" | "medium" | "risk";
  is_low_efficiency: boolean;
  flagged_this_submission: boolean;
  entry_number: number;
  low_efficiency_count: number;
  next_entry_allowed_at: string | null;
  worker: Worker;
  demoMode: boolean;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h > 0 ? `${h}h ` : ""}${m}m ${s}s`;
}

export default function SubmitPage() {
  const [demoMode, setDemoMode] = useState(false);
  const [session, setSession] = useState<EmployeeSession | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [lineTarget, setLineTarget] = useState<LineTarget | null>(null);
  const [unseenNotifications, setUnseenNotifications] = useState<any[]>([]);
  const [entriesSubmitted, setEntriesSubmitted] = useState(0);

  const [stage, setStage] = useState<Stage>("form");
  const [actualOutput, setActualOutput] = useState<string>("");
  const [availableMinutes, setAvailableMinutes] = useState<string>("480");
  const [downtimeMinutes, setDowntimeMinutes] = useState<string>("0");
  const [downtimeReason, setDowntimeReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const [countdownDone, setCountdownDone] = useState(false);
  const [pendingResult, setPendingResult] = useState<SubmissionResult | null>(null);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Refresh the current time every second so the "next entry in…" lock
  // display and any auto-unlock happen without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function loadProfile(activeSession: EmployeeSession) {
    try {
      const data = await api.getMyProfile();
      setWorker(data.worker);
      setUnseenNotifications(data.unseen_notifications || []);
      setEntriesSubmitted(data.entries_submitted || 0);
      setDemoMode(false);

      try {
        const targets = await api.getLineTargets();
        setLineTarget(targets.find((t: LineTarget) => t.line === data.worker.line) || null);
      } catch {
        // non-fatal — targets are informational
      }
    } catch (err) {
      if (err instanceof ApiAuthError && err.status === 401) {
        // Session expired — log out and show the login form again.
        employeeAuth.clear();
        setSession(null);
        setWorker(null);
        return;
      }
      if (err instanceof ApiUnavailableError) {
        // Backend unreachable — fall back to demo mode using the session
        // we already have client-side.
        const demoWorker = DEMO_WORKERS.find((w) => w.id === activeSession.employee.id);
        if (demoWorker) {
          setWorker(demoWorker);
          setLineTarget(DEMO_LINE_TARGETS.find((t) => t.line === demoWorker.line) || null);
        }
        setDemoMode(true);
      }
    }
  }

  useEffect(() => {
    const existing = employeeAuth.get();
    if (existing) {
      setSession(existing);
      loadProfile(existing);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEmployeeLogin(pin: string) {
    try {
      const data = await api.employeeLogin(pin);
      employeeAuth.set(data);
      setSession(data);
      await loadProfile(data);
    } catch (err) {
      if (err instanceof ApiUnavailableError) {
        // No backend reachable at all — try demo-mode PIN matching so the
        // page still works for a local/offline walkthrough.
        const workerId = DEMO_EMPLOYEE_PINS[pin];
        if (!workerId) throw new Error("Incorrect PIN.");
        const demoWorker = DEMO_WORKERS.find((w) => w.id === workerId)!;
        const demoSession: EmployeeSession = {
          token: "demo",
          employee: {
            id: demoWorker.id,
            name: demoWorker.name,
            line: demoWorker.line,
            flagged: demoWorker.flagged,
            next_entry_allowed_at: demoWorker.next_entry_allowed_at ?? null,
          },
        };
        employeeAuth.set(demoSession);
        setSession(demoSession);
        setWorker(demoWorker);
        setLineTarget(DEMO_LINE_TARGETS.find((t) => t.line === demoWorker.line) || null);
        setDemoMode(true);
        return;
      }
      throw err;
    }
  }

  function handleLogout() {
    employeeAuth.clear();
    setSession(null);
    setWorker(null);
    setResult(null);
    setStage("form");
  }

  async function dismissNotifications() {
    setUnseenNotifications([]);
    if (!demoMode) {
      try {
        await api.markMyNotificationsSeen();
      } catch {
        // non-fatal
      }
    }
  }

  // Reveal the result only once BOTH the countdown has finished and the
  // (near-instant) ML analysis has actually returned.
  useEffect(() => {
    if (countdownDone && pendingResult) {
      setResult(pendingResult);
      setStage("result");
    }
  }, [countdownDone, pendingResult]);

  const lockRemainingMs = worker?.next_entry_allowed_at
    ? new Date(worker.next_entry_allowed_at).getTime() - now
    : 0;
  const isLocked = lockRemainingMs > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!actualOutput || !worker) return;

    setError(null);
    setCountdownDone(false);
    setPendingResult(null);
    setResult(null);
    setStage("analyzing");

    try {
      if (demoMode) {
        const prediction = {
          efficiency: Number(
            (((Number(actualOutput) * worker.smv) / (Number(availableMinutes) || 480)) * 100).toFixed(2)
          ),
          variance: 0,
          risk_level: "low" as const,
        };
        prediction.variance = Number((prediction.efficiency - 100).toFixed(2));
        const absVar = Math.abs(prediction.variance);
        const risk_level = absVar <= 10 ? "low" : absVar <= 25 ? "medium" : "high";
        const efficiency_category = categorizeEfficiency(prediction.efficiency);
        const entryNumber = entriesSubmitted + 1;
        const isProbation = entryNumber <= 3;
        const belowFloor = prediction.efficiency < 50;
        const justFlagged = isProbation && belowFloor && !worker.flagged;
        const nextAllowed = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        const updatedWorker: Worker = {
          ...worker,
          flagged: worker.flagged || justFlagged,
          flagged_at: justFlagged ? new Date().toISOString() : worker.flagged_at,
          low_efficiency_count: worker.low_efficiency_count + (isProbation && belowFloor ? 1 : 0),
          next_entry_allowed_at: nextAllowed,
        };

        setEntriesSubmitted(entryNumber);
        setWorker(updatedWorker);
        setPendingResult({
          efficiency: prediction.efficiency,
          variance: prediction.variance,
          risk_level,
          efficiency_category,
          is_low_efficiency: belowFloor,
          flagged_this_submission: justFlagged,
          entry_number: entryNumber,
          low_efficiency_count: updatedWorker.low_efficiency_count,
          next_entry_allowed_at: nextAllowed,
          worker: updatedWorker,
          demoMode: true,
        });
      } else {
        const payload = {
          actual_output: Number(actualOutput),
          available_minutes: Number(availableMinutes) || 480,
          downtime_minutes: Number(downtimeMinutes) || 0,
          downtime_reason: downtimeReason || null,
          notes: notes || null,
        };
        const res = await api.submitProduction(payload);
        setWorker(res.worker);
        setPendingResult({
          efficiency: res.log.efficiency,
          variance: res.log.variance,
          risk_level: res.log.risk_level,
          efficiency_category: res.log.efficiency_category,
          is_low_efficiency: res.log.is_low_efficiency,
          flagged_this_submission: res.flagged_this_submission,
          entry_number: res.entry_number,
          low_efficiency_count: res.low_efficiency_count,
          next_entry_allowed_at: res.next_entry_allowed_at,
          worker: res.worker,
          demoMode: false,
        });
      }
    } catch (err) {
      if (err instanceof ApiAuthError) {
        // 403 = flagged/blocked, 429 = still inside the 1-hour lock.
        // Refresh the worker state so the lock/blocked view takes over.
        setError(err.message);
        if (session) loadProfile(session);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong while submitting.");
      }
      setStage("form");
    }
  }

  function resetForm() {
    setStage("form");
    setActualOutput("");
    setDowntimeMinutes("0");
    setDowntimeReason("");
    setNotes("");
    setResult(null);
    setPendingResult(null);
    setCountdownDone(false);
  }

  // --- Not logged in -----------------------------------------------------
  if (!session || !worker) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="mb-2">
          <h1 className="text-2xl font-bold text-slate-900">Submit Production Log</h1>
          <p className="text-slate-500 text-sm mt-1">
            Log in with your individual PIN to submit your hourly production entry.
          </p>
        </div>
        <PinLoginCard
          title="Employee Login"
          description="Enter your personal PIN to continue."
          onSubmit={handleEmployeeLogin}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Submit Production Log</h1>
          <p className="text-slate-500 text-sm mt-1">
            Efficiency is calculated with the Sri Lankan garment industry formula:{" "}
            <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
              (Actual Output × SMV / Available Minutes) × 100
            </code>
          </p>
          {demoMode && (
            <p className="text-xs text-amber-600 mt-2">
              Running in frontend demo mode — no backend detected, results are calculated locally.
            </p>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="shrink-0 text-sm border border-slate-300 hover:bg-slate-50 rounded-lg px-3 py-1.5 font-medium transition"
        >
          Log Out
        </button>
      </div>

      {/* Logged-in employee summary */}
      <div className="card mb-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-slate-900">{worker.name}</p>
            <p className="text-xs text-slate-500">
              {worker.line} · SMV {worker.smv} · Daily target {worker.daily_target}
              {lineTarget && (
                <> · Line target {lineTarget.target_per_hour}/hr · {lineTarget.target_per_day}/day</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {worker.efficiency_category && <EfficiencyCategoryBadge category={worker.efficiency_category} />}
            {worker.flagged && <FlaggedBadge />}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Entries submitted: {entriesSubmitted} · {worker.low_efficiency_count}/3 low-efficiency entries in
          probation window
        </p>
      </div>

      {/* Unseen flag notification */}
      {unseenNotifications.length > 0 && (
        <div className="rounded-xl border-2 border-red-600 bg-red-50 p-5 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <FlaggedBadge />
            <span className="font-bold text-red-700">You've Been Flagged</span>
          </div>
          {unseenNotifications.map((n) => (
            <p key={n.id} className="text-sm text-red-700 mt-1">
              {n.message}
            </p>
          ))}
          <button
            onClick={dismissNotifications}
            className="mt-3 text-sm border border-red-300 text-red-700 hover:bg-red-100 rounded-lg px-3 py-1.5 font-medium transition"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Blocked: flagged, awaiting supervisor clearance */}
      {worker.flagged ? (
        <div className="card border-red-200 bg-red-50/40">
          <h2 className="font-bold text-red-700 mb-1">Submissions Blocked</h2>
          <p className="text-sm text-red-700">
            Your account is flagged for low efficiency during your first 3 entries. A supervisor must
            clear the flag on the Workers page before you can submit another entry.
          </p>
        </div>
      ) : isLocked && stage === "form" ? (
        <div className="card">
          <h2 className="font-semibold text-slate-800 mb-1">Next Entry Available Soon</h2>
          <p className="text-sm text-slate-500">
            You've already submitted an entry this hour. Your next entry opens in{" "}
            <span className="font-semibold text-slate-800">{formatCountdown(lockRemainingMs)}</span>.
          </p>
        </div>
      ) : (
        <>
          {stage === "form" && (
            <form onSubmit={handleSubmit} className="card space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Actual Output (units)</label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={actualOutput}
                    onChange={(e) => setActualOutput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="e.g. 120"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Available Minutes</label>
                  <input
                    type="number"
                    min="1"
                    value={availableMinutes}
                    onChange={(e) => setAvailableMinutes(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Downtime (minutes)</label>
                  <input
                    type="number"
                    min="0"
                    value={downtimeMinutes}
                    onChange={(e) => setDowntimeMinutes(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Downtime Reason</label>
                  <input
                    type="text"
                    value={downtimeReason}
                    onChange={(e) => setDowntimeReason(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="e.g. machine breakdown"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg py-2.5 transition"
              >
                Submit & Analyze
              </button>
            </form>
          )}

          {stage === "analyzing" && <AnalysisCountdown onComplete={() => setCountdownDone(true)} />}

          {stage === "result" && result && (
            <div className="space-y-4">
              {result.flagged_this_submission && (
                <div className="rounded-xl border-2 border-red-600 bg-red-50 p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <FlaggedBadge />
                    <span className="font-bold text-red-700">Worker Flagged</span>
                  </div>
                  <p className="text-sm text-red-700">
                    <strong>{result.worker.name}</strong>'s entry #{result.entry_number} came in below the
                    50% efficiency floor during their first 3 entries and has been automatically flagged on{" "}
                    <strong>{result.worker.line}</strong>. Further submissions are blocked until a
                    supervisor clears the flag.
                  </p>
                </div>
              )}

              <div className="card space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900">Analysis Result</h2>
                  <div className="flex items-center gap-2">
                    <EfficiencyCategoryBadge category={result.efficiency_category} />
                    <RiskBadge level={result.risk_level} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{result.efficiency}%</p>
                    <p className="text-xs text-slate-500">Efficiency</p>
                  </div>
                  <div>
                    <p className={`text-2xl font-bold ${result.variance < 0 ? "text-red-600" : "text-green-600"}`}>
                      {result.variance > 0 ? "+" : ""}
                      {result.variance}%
                    </p>
                    <p className="text-xs text-slate-500">Variance vs Target</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900">#{result.entry_number}</p>
                    <p className="text-xs text-slate-500">Entry Number</p>
                  </div>
                </div>

                {result.is_low_efficiency && !result.flagged_this_submission && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                    This entry came in below the 50% efficiency floor for <strong>{result.worker.name}</strong>{" "}
                    on {result.worker.line}. Only entries within the first 3 ever submitted count toward an
                    automatic flag.
                  </div>
                )}

                {result.next_entry_allowed_at && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-600">
                    Your next entry opens at{" "}
                    <strong>{new Date(result.next_entry_allowed_at).toLocaleTimeString()}</strong> (1 hour
                    from this submission).
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={resetForm}
                    className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg py-2.5 transition"
                  >
                    Back
                  </button>
                  <Link
                    href="/dashboard"
                    className="flex-1 text-center border border-slate-300 hover:bg-slate-50 font-semibold rounded-lg py-2.5 transition"
                  >
                    View Dashboard
                  </Link>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
