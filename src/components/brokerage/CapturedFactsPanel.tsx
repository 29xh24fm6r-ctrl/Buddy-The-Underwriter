"use client";

// "Captured so far" — shows the borrower what Buddy's chat/voice concierge
// has extracted from the conversation, with an inline correction affordance.
// Before this, extracted facts were computed and sent to the client every
// turn (see /api/brokerage/concierge) but never rendered — if the AI
// mis-heard a number or name, the borrower had no way to see or fix it.

import { useState } from "react";
import {
  CORRECTABLE_FACT_FIELDS,
  readFactValue,
  type CorrectableField,
} from "@/lib/brokerage/correctableFacts";

function formatValue(field: CorrectableField, raw: unknown): string {
  if (raw == null || raw === "") return "";
  if (field.type === "number" && typeof raw === "number") {
    return field.factPath === "loan.amount_requested" ? `$${raw.toLocaleString()}` : String(raw);
  }
  if (field.type === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}

function EditableRow({
  field,
  value,
  onSave,
}: {
  field: CorrectableField;
  value: unknown;
  onSave: (factPath: string, value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => (value == null ? "" : String(value)));
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span className="text-slate-500">{field.label}</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-slate-800">
            {formatValue(field, value) || "—"}
          </span>
          <button
            type="button"
            onClick={() => {
              setDraft(value == null ? "" : String(value));
              setEditing(true);
            }}
            className="text-xs text-brand-blue-500 hover:underline"
            aria-label={`Correct ${field.label}`}
          >
            ✏️
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1.5 text-sm">
      <span className="w-1/2 shrink-0 text-slate-500">{field.label}</span>
      <input
        type={field.type === "number" ? "number" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
      />
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          await onSave(field.factPath, draft);
          setSaving(false);
          setEditing(false);
        }}
        className="rounded-lg bg-brand-blue-500 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        {saving ? "…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs text-slate-400 hover:text-slate-600"
      >
        Cancel
      </button>
    </div>
  );
}

export function CapturedFactsPanel({
  facts,
  onCorrected,
}: {
  facts: Record<string, unknown>;
  onCorrected: (facts: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);

  const filled = CORRECTABLE_FACT_FIELDS.filter((f) => {
    const v = readFactValue(facts, f.factPath);
    return v != null && v !== "";
  });

  if (filled.length === 0) return null;

  const save = async (factPath: string, value: string) => {
    try {
      const res = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factPath, value }),
        credentials: "include",
      });
      const json = await res.json();
      if (json?.ok && json.extractedFacts) onCorrected(json.extractedFacts);
    } catch {
      // Non-fatal — the row just keeps showing the last-known value.
    }
  };

  return (
    <div className="border-b border-slate-200 bg-white px-6 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        <span>Captured so far ({filled.length})</span>
        <span className="text-slate-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-2 divide-y divide-slate-100">
          {filled.map((field) => (
            <EditableRow
              key={field.factPath}
              field={field}
              value={readFactValue(facts, field.factPath)}
              onSave={save}
            />
          ))}
        </div>
      )}
    </div>
  );
}
