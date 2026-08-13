"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_SECONDS = 20;

interface AnalysisCountdownProps {
  /** Called once when the countdown reaches zero. */
  onComplete: () => void;
  /** Optional label shown above the timer. */
  label?: string;
}

/**
 * 20-second countdown shown while the ML prediction "analyzes" the
 * submitted production log. The real API call typically finishes in
 * milliseconds — this timer is a deliberate UX pacing device that reveals
 * the result only once the countdown reaches zero, building suspense.
 *
 * This is separate from the real, backend-enforced 1-hour gap between an
 * employee's submissions (see next_entry_allowed_at) — that lock is a
 * true rate limit, not a UI animation, and is shown on the result screen
 * afterwards rather than as a 60x-longer version of this countdown.
 */
export function AnalysisCountdown({ onComplete, label = "Analyzing production data" }: AnalysisCountdownProps) {
  const [remaining, setRemaining] = useState(DURATION_SECONDS);
  const firedRef = useRef(false);

  useEffect(() => {
    if (remaining <= 0) {
      if (!firedRef.current) {
        firedRef.current = true;
        onComplete();
      }
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const progress = 1 - remaining / DURATION_SECONDS;
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - progress);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="card flex flex-col items-center justify-center py-10 gap-4">
      <div className="relative w-36 h-36">
        <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="#e2e8f0" strokeWidth="8" />
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke="#dc2626"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold text-slate-800 tabular-nums">
            {minutes}:{seconds.toString().padStart(2, "0")}
          </span>
        </div>
      </div>
      <div className="text-center">
        <p className="font-semibold text-slate-800">{label}…</p>
        <p className="text-sm text-slate-500 mt-1">
          Running the Sri Lankan efficiency formula, variance check, and risk classification.
        </p>
      </div>
    </div>
  );
}
