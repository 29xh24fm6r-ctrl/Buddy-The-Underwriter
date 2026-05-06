"use client";

import { useState } from "react";
import type { DealFactConflict } from "@/lib/creditMemo/inputs/types";

type Props = {
  dealId: string;
  initial: DealFactConflict[];
};

export default function FactConflictsPanel({ dealId, initial }: Props) {
  const [conflicts, setConflicts] = useState<DealFactConflict[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function applyStatus(
    conflict: DealFactConflict,
    newStatus: "acknowledged" | "resolved" | "ignored",
    resolution?: string,
    resolvedValue?: unknown,
  ) {
    setBusyId(conflict.id);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo-inputs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "conflicts",
          id: conflict.id,
          status: newStatus,
          resolution,
          resolved_value: resolvedValue,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save_failed");
      setConflicts((cs) =>
        cs.map((c) => (c.id === conflict.id ? (json.conflict as DealFactConflict) : c)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (conflicts.length === 0) {
    return (
      <section id="conflicts" className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Conflicts / Exceptions</h2>
        <p className="mt-1 text-sm text-gray-600">No fact conflicts detected.</p>
      </section>
    );
  }

  return (
    <section id="conflicts" className="rounded-lg border border-gray-200 bg-white p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">Conflicts / Exceptions</h2>
        <p className="text-xs text-gray-500">
          Open conflicts must be resolved or acknowledged before submission.
        </p>
      </header>
      <div className="space-y-3">
        {conflicts.map((c) => (
          <div
            key={c.id}
            className={`rounded-md border p-3 ${
              c.status === "open"
                ? "border-rose-300 bg-rose-50"
                : c.status === "acknowledged"
                ? "border-amber-300 bg-amber-50"
                : "border-gray-200 bg-gray-50"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{c.fact_key}</div>
                <div className="text-xs text-gray-700">
                  Type: {c.conflict_type} · Status: {c.status}
                </div>
                <div className="mt-1 text-xs text-gray-700">
                  <SourceLine label="A" payload={c.source_a} />
                  <SourceLine label="B" payload={c.source_b} />
                </div>
                {c.resolution ? (
                  <div className="mt-1 text-xs text-gray-700">Resolution: {c.resolution}</div>
                ) : null}
              </div>
              {c.status === "open" || c.status === "acknowledged" ? (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() =>
                      applyStatus(c, "resolved", "Banker selected source B", (c.source_b as any)?.value ?? null)
                    }
                    className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Resolve (use B)
                  </button>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() =>
                      applyStatus(c, "resolved", "Banker selected source A", (c.source_a as any)?.value ?? null)
                    }
                    className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Resolve (use A)
                  </button>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => applyStatus(c, "acknowledged", "Banker acknowledged")}
                    className="rounded-md border border-amber-400 bg-white px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => applyStatus(c, "ignored", "Banker dismissed")}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Ignore
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {error ? <div className="mt-2 text-xs text-rose-700">{error}</div> : null}
    </section>
  );
}

function SourceLine({ label, payload }: { label: string; payload: unknown }) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const value = typeof p.value === "number" ? p.value.toLocaleString() : String(p.value);
  return (
    <div>
      <span className="font-medium">{label}.</span>{" "}
      {String(p.label ?? p.role ?? "source")}
      {p.period_end ? ` (${p.period_end})` : ""}: {value}
    </div>
  );
}
