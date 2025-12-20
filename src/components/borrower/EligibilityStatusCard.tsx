"use client";

import React from "react";
import type { SbaEligibilityResult } from "@/lib/sba7a/eligibility";

type Props = {
  result: SbaEligibilityResult | null | undefined;
  title?: string;
};

export default function EligibilityStatusCard({ result, title = "SBA 7(a) Eligibility" }: Props) {
  if (!result) {
    return (
      <div className="rounded-xl border p-4">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-2 text-sm text-muted-foreground">No eligibility result yet.</div>
      </div>
    );
  }

  const status =
    (result as any).eligible === true
      ? "Eligible"
      : (result as any).eligible === false
        ? "Not eligible"
        : "Unknown";

  const gates: any[] = Array.isArray((result as any).gates) ? (result as any).gates : [];
  const reasons: any[] = Array.isArray((result as any).reasons) ? (result as any).reasons : [];
  const requiredDocs: any[] = Array.isArray((result as any).required_documents)
    ? (result as any).required_documents
    : [];
  const warnings: any[] = Array.isArray((result as any).warnings) ? (result as any).warnings : [];


  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs rounded-full border px-2 py-1">{status}</div>
      </div>

      {/* Gates */}
      {gates.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Gates
          </div>
          <ul className="mt-2 space-y-2">
            {gates.map((gate: any, i: number) => (
              <li key={gate?.code ?? i} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{gate?.title ?? gate?.label ?? `Gate ${i + 1}`}</div>
                  <div className="text-xs rounded-full border px-2 py-0.5">
                    {gate?.ok === true ? "Pass" : gate?.ok === false ? "Fail" : "Unknown"}
                  </div>
                </div>
                {gate?.message && <div className="mt-2 text-sm text-muted-foreground">{gate.message}</div>}
                {Array.isArray(gate?.reasons) && gate.reasons.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                    {gate.reasons.map((r: any, j: number) => (
                      <li key={`${i}-${j}`}>{String(r)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reasons */}
      {reasons.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reasons
          </div>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {reasons.map((reason: any, i: number) => (
              <li key={i}>{typeof reason === "string" ? reason : reason?.message ?? JSON.stringify(reason)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Required docs */}
      {requiredDocs.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Required documents
          </div>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {requiredDocs.map((item: any, i: number) => (
              <li key={i}>{typeof item === "string" ? item : item?.name ?? JSON.stringify(item)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Warnings
          </div>
          <ul className="mt-2 list-disc pl-5 text-sm text-amber-700">
            {warnings.map((warning: any, i: number) => (
              <li key={i}>{typeof warning === "string" ? warning : warning?.message ?? JSON.stringify(warning)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
