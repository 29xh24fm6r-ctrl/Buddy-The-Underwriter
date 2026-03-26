"use client";

import { useState } from "react";

type FactAction = "confirm_fact" | "select_conflict_source" | "adjust_fact" | "reject_fact" | "mark_follow_up_needed";

type Props = {
  dealId: string;
  factId: string;
  snapshotId: string;
  metricLabel: string;
  currentValue: number | null;
  validationState: string;
  hasConflict: boolean;
  onComplete: () => void;
};

export function FinancialFactDecisionForm({
  dealId, factId, snapshotId, metricLabel, currentValue, validationState, hasConflict, onComplete,
}: Props) {
  const [action, setAction] = useState<FactAction | "">("");
  const [rationale, setRationale] = useState("");
  const [replacementValue, setReplacementValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresRationale = action === "adjust_fact" || action === "reject_fact";

  const handleSubmit = async () => {
    if (!action) return;
    if (requiresRationale && !rationale.trim()) {
      setError("Rationale is required for this action");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { action, snapshotId, rationale: rationale.trim() || undefined };
      if (action === "adjust_fact" && replacementValue) {
        body.replacementValue = parseFloat(replacementValue);
      }

      const res = await fetch(`/api/deals/${dealId}/financial-validation/${factId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Action failed");
      }
      onComplete();
    } catch (err: any) {
      setError(err?.message ?? "Failed to apply decision");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 border-t pt-3 mt-3">
      <div className="text-xs font-semibold text-gray-500">Review: {metricLabel}</div>

      <select
        value={action}
        onChange={(e) => { setAction(e.target.value as FactAction); setError(null); }}
        className="w-full text-xs border rounded px-2 py-1.5"
      >
        <option value="">Choose action...</option>
        <option value="confirm_fact">Confirm fact</option>
        {hasConflict && <option value="select_conflict_source">Select conflict source</option>}
        <option value="adjust_fact">Adjust value</option>
        <option value="reject_fact">Reject fact</option>
        <option value="mark_follow_up_needed">Mark follow-up needed</option>
      </select>

      {action === "adjust_fact" && (
        <input
          type="number"
          placeholder={`Current: ${currentValue ?? "N/A"}`}
          value={replacementValue}
          onChange={(e) => setReplacementValue(e.target.value)}
          className="w-full text-xs border rounded px-2 py-1.5"
        />
      )}

      {requiresRationale && (
        <textarea
          placeholder="Rationale (required)"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          className="w-full text-xs border rounded px-2 py-1.5 h-16 resize-none"
        />
      )}

      {!requiresRationale && action && (
        <textarea
          placeholder="Optional note"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          className="w-full text-xs border rounded px-2 py-1.5 h-12 resize-none"
        />
      )}

      {error && <div className="text-xs text-red-600">{error}</div>}

      <button
        onClick={handleSubmit}
        disabled={!action || saving}
        className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? "Applying..." : "Apply Decision"}
      </button>
    </div>
  );
}
