"use client";

import { useState } from "react";

interface PinLoginCardProps {
  title: string;
  description: string;
  buttonLabel?: string;
  onSubmit: (pin: string) => Promise<void>;
}

/**
 * Small PIN-entry card, styled with the same `.card` / input classes used
 * everywhere else in the app. Used to gate employee submission and
 * supervisor-only actions (acknowledge alert, clear flag) behind a login.
 */
export function PinLoginCard({ title, description, buttonLabel = "Log In", onSubmit }: PinLoginCardProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(pin);
      setPin("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 max-w-sm">
      <div>
        <h2 className="font-semibold text-slate-800">{title}</h2>
        <p className="text-sm text-slate-500 mt-1">{description}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">PIN</label>
        <input
          required
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-widest"
          placeholder="••••"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold rounded-lg py-2.5 transition"
      >
        {submitting ? "Checking…" : buttonLabel}
      </button>
    </form>
  );
}
