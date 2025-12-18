"use client";

import React, { useMemo } from "react";
import { evaluateRequirements, summarizeCoverage } from "@/lib/packs/requirements/evaluate";
import { getDefaultRequirements, type DealKind } from "@/lib/packs/requirements/defaults";
import { buildMissingDocsEmail } from "@/lib/packs/requirements/requestEmail";

export default function PackCoverageCard({
  packIndex,
  dealKind,
  taxYears,
  onJumpToDocType,
  borrowerName,
  dealName,
}: {
  packIndex: any;
  dealKind: DealKind;
  taxYears: number[];
  onJumpToDocType?: (docType: string, year?: number) => void;
  borrowerName?: string;
  dealName?: string;
}) {
  const reqs = useMemo(() => getDefaultRequirements({ dealKind, taxYears }), [dealKind, taxYears]);
  const results = useMemo(() => evaluateRequirements(packIndex, reqs), [packIndex, reqs]);
  const summary = useMemo(() => summarizeCoverage(results), [results]);

  const missing = results.filter((r) => r.status === "MISSING" || r.status === "PARTIAL");

  const handleCopyEmail = async () => {
    const emailText = buildMissingDocsEmail({
      borrowerName,
      dealName,
      results,
    });

    try {
      await navigator.clipboard.writeText(emailText);
      // You could add a toast notification here
      alert("Email copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy email:", err);
      alert("Failed to copy email to clipboard");
    }
  };

  return (
    <div className="rounded border bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Coverage Checklist</div>
        <div className="text-xs text-neutral-500">
          {summary.satisfied}/{summary.totalRequired} required
        </div>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
        <div className="rounded border p-2">
          <div className="font-semibold">{summary.satisfied}</div>
          <div className="text-neutral-500">Satisfied</div>
        </div>
        <div className="rounded border p-2">
          <div className="font-semibold">{summary.partial}</div>
          <div className="text-neutral-500">Partial</div>
        </div>
        <div className="rounded border p-2">
          <div className="font-semibold">{summary.missing}</div>
          <div className="text-neutral-500">Missing</div>
        </div>
        <div className="rounded border p-2">
          <div className="font-semibold">{summary.optional}</div>
          <div className="text-neutral-500">Optional</div>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="mt-3">
          <button
            onClick={handleCopyEmail}
            className="w-full rounded border bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100"
          >
            📧 Copy request email
          </button>
        </div>
      )}

      <div className="mt-3">
        <div className="text-xs font-semibold text-neutral-600">Needs attention</div>
        {missing.length === 0 ? (
          <div className="mt-1 rounded bg-neutral-50 p-2 text-sm text-neutral-600">
            Nice — required checklist looks complete.
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {missing.map((r) => (
              <div key={r.requirement.id} className="rounded border p-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{r.requirement.label}</div>
                  <div className="text-xs text-neutral-500">{r.status}</div>
                </div>
                <div className="mt-1 text-xs text-neutral-600">{r.message}</div>

                {onJumpToDocType && (
                  <button
                    className="mt-2 rounded border px-2 py-1 text-xs hover:bg-neutral-50"
                    onClick={() => onJumpToDocType?.(extractDocTypeHint(r), extractYearHint(r))}
                  >
                    Jump to section
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// lightweight hints so Jump button can switch scope (you can refine later)
function extractDocTypeHint(r: any): string {
  const rule = r.requirement.rule;
  if (rule.rule === "DOC_TYPE_MIN_COUNT" || rule.rule === "DOC_TYPE_PER_YEAR") return rule.docType;
  return "UNKNOWN";
}
function extractYearHint(r: any): number | undefined {
  const rule = r.requirement.rule;
  if (rule.rule === "DOC_TYPE_PER_YEAR") return (rule.years?.[0] as number) ?? undefined;
  return undefined;
}