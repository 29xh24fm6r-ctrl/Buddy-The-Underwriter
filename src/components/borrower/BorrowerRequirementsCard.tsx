"use client";

import React from "react";

export default function BorrowerRequirementsCard({
  result,
}: {
  result: any;
}) {
  if (!result) {
    return (
      <div className="rounded border bg-white p-4">
        <div className="text-sm font-semibold">Checklist</div>
        <div className="mt-2 text-sm text-neutral-600">Preparing checklist…</div>
      </div>
    );
  }

  const s = result.summary;
  const reqs = Array.isArray(result.requirements) ? result.requirements : [];

  const missing = reqs.filter((r: any) => r.required && (r.status === "MISSING" || r.status === "PARTIAL"));
  const progress =
    s?.required_total ? `${s.required_satisfied}/${s.required_total} required` : "—";

  return (
    <div className="rounded border bg-white p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Checklist</div>
        <div className="text-xs text-neutral-600">{progress}</div>
      </div>

      {Array.isArray(result.derived_tax_years) && result.derived_tax_years.length > 0 && (
        <div className="text-xs text-neutral-500">
          Tax years in scope: {result.derived_tax_years.join(", ")}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Satisfied" value={s?.required_satisfied ?? 0} />
        <Stat label="Missing" value={s?.required_missing ?? 0} />
        <Stat label="Partial" value={s?.required_partial ?? 0} />
      </div>

      {missing.length > 0 ? (
        <div className="mt-2">
          <div className="text-xs font-semibold text-neutral-700">Needs attention</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 space-y-1">
            {missing.slice(0, 8).map((r: any) => (
              <li key={r.id}>
                {r.title}
                {Array.isArray(r.notes) && r.notes.length > 0 ? (
                  <div className="text-[11px] text-neutral-500">{r.notes[0]}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-sm text-neutral-600">Nice — you've satisfied the current required checklist.</div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
