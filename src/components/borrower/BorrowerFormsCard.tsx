"use client";

import React from "react";

export default function BorrowerFormsCard({ result }: { result: any }) {
  if (!result) {
    return (
      <div className="rounded border bg-white p-4">
        <div className="text-sm font-semibold">Forms readiness</div>
        <div className="mt-2 text-sm text-neutral-600">Preparing form data…</div>
      </div>
    );
  }

  const errs = Array.isArray(result.validation_errors) ? result.validation_errors : [];
  const errors = errs.filter((e: any) => e.severity === "ERROR");
  const warns = errs.filter((e: any) => e.severity === "WARN");

  const badge =
    result.status === "READY"
      ? "✅ Ready"
      : result.status === "ERROR"
      ? "⛔ Needs fixes"
      : "🟡 Draft";

  return (
    <div className="rounded border bg-white p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Forms readiness</div>
        <div className="text-xs">{badge}</div>
      </div>

      <div className="text-xs text-neutral-600">
        Form: <span className="font-semibold">{result.form_name}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Errors" value={errors.length} />
        <Stat label="Warnings" value={warns.length} />
      </div>

      {errors.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-neutral-700">Blocking issues</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 space-y-1">
            {errors.slice(0, 8).map((e: any, i: number) => (
              <li key={i}>
                {e.message}
                <div className="text-[11px] text-neutral-500">{e.path}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length === 0 && warns.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-neutral-700">Warnings</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 space-y-1">
            {warns.slice(0, 6).map((e: any, i: number) => (
              <li key={i}>
                {e.message}
                <div className="text-[11px] text-neutral-500">{e.path}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length === 0 && warns.length === 0 && (
        <div className="text-sm text-neutral-600">
          Nice — the current intake data is form-ready.
        </div>
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
