// Renders a frozen, banker-submitted Florida Armory memo snapshot.
//
// Reads ONLY from credit_memo_snapshots.memo_output_json. Never calls
// buildCanonicalCreditMemo. The underwriter sees exactly what the banker
// certified — no live recompute, no drift.

import React from "react";
import UnderwriterDecisionForm from "./UnderwriterDecisionForm";
import CreditMemoIntelligencePanels from "./CreditMemoIntelligencePanels";
import type { FloridaArmoryMemoSnapshot, FloridaArmorySection } from "@/lib/creditMemo/snapshot/types";

type Props = {
  dealId: string;
  snapshotId: string;
  status: "banker_submitted" | "underwriter_review" | "finalized" | "returned";
  memoVersion: number;
  snapshot: FloridaArmoryMemoSnapshot;
  underwriterFeedback: Record<string, unknown> | null;
};

const STATUS_BADGE: Record<Props["status"], { label: string; className: string }> = {
  banker_submitted: { label: "Banker Submitted", className: "bg-amber-100 text-amber-800 border-amber-200" },
  underwriter_review: { label: "Underwriter Review", className: "bg-sky-100 text-sky-800 border-sky-200" },
  finalized: { label: "Finalized", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  returned: { label: "Returned for Revision", className: "bg-rose-100 text-rose-800 border-rose-200" },
};

export default function SubmittedMemoView({
  dealId,
  snapshotId,
  status,
  memoVersion,
  snapshot,
  underwriterFeedback,
}: Props) {
  const meta = snapshot.meta;
  const banker = snapshot.banker_submission;
  const diag = snapshot.diagnostics;
  const badge = STATUS_BADGE[status];

  return (
    <div className="bg-white min-h-screen">
      <div className="mx-auto max-w-[980px] p-8">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#111418]">Credit Memo (Frozen Snapshot)</h1>
            <div className="text-xs text-gray-500">
              Florida Armory · {meta.bank_id} · v{memoVersion}
            </div>
          </div>
          <span
            className={`text-[11px] font-semibold border rounded px-2 py-1 ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>

        {/* ── Submission attestation ─────────────────────────────── */}
        <div className="mb-6 rounded-md border border-gray-200 bg-gray-50 p-4">
          <div className="text-[11px] font-semibold text-gray-600 uppercase mb-2">
            Submission Attestation
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-gray-500">Submitted by</dt>
            <dd className="font-mono text-gray-900">{meta.submitted_by}</dd>
            <dt className="text-gray-500">Submitted at</dt>
            <dd className="font-mono text-gray-900">{new Date(meta.submitted_at).toLocaleString()}</dd>
            <dt className="text-gray-500">Memo version</dt>
            <dd className="font-mono text-gray-900">v{meta.memo_version}</dd>
            <dt className="text-gray-500">Input hash</dt>
            <dd className="font-mono text-[10px] text-gray-700 break-all">{meta.input_hash}</dd>
            <dt className="text-gray-500">Schema</dt>
            <dd className="font-mono text-gray-900">{snapshot.schema_version}</dd>
            <dt className="text-gray-500">Render mode</dt>
            <dd className="font-mono text-gray-900">{meta.render_mode}</dd>
          </dl>
          {banker.notes && (
            <div className="mt-3 rounded border border-gray-200 bg-white p-2 text-xs text-gray-800">
              <span className="font-semibold">Banker notes: </span>
              {banker.notes}
            </div>
          )}
        </div>

        {/* ── Readiness contract result ─────────────────────────── */}
        <div className="mb-6 rounded-md border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-semibold text-gray-600 uppercase mb-2">
            Readiness Contract ({diag.readiness_contract.contractVersion})
          </div>
          <div className="text-xs text-gray-700">
            All required items passed at submission. Source coverage:{" "}
            <span className="font-mono">{diag.source_coverage.document_sources}</span> documents,{" "}
            <span className="font-mono">{diag.source_coverage.financial_fact_sources}</span> facts,{" "}
            <span className="font-mono">{diag.source_coverage.research_sources}</span> research,{" "}
            <span className="font-mono">{diag.source_coverage.override_sources}</span> overrides.
          </div>
          {diag.warnings.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] font-semibold text-amber-700 uppercase">Section warnings</div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800">
                {diag.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Intelligence panels (above sections) ───────────────── */}
        <div className="mb-6">
          <div className="text-[11px] font-semibold text-gray-600 uppercase mb-2">
            Credit Memo Intelligence
          </div>
          <CreditMemoIntelligencePanels dealId={dealId} />
        </div>

        {/* ── Sections ──────────────────────────────────────────── */}
        <div className="space-y-6">
          {Object.entries(snapshot.sections).map(([key, section]) => (
            <SectionBlock key={key} section={section} />
          ))}
        </div>

        {/* ── Underwriter feedback (if any) ──────────────────────── */}
        {underwriterFeedback && Object.keys(underwriterFeedback).length > 0 && (
          <div className="mt-8 rounded-md border border-gray-200 bg-gray-50 p-4">
            <div className="text-[11px] font-semibold text-gray-600 uppercase mb-2">
              Underwriter Feedback
            </div>
            <pre className="text-[11px] text-gray-800 whitespace-pre-wrap break-all font-mono">
              {JSON.stringify(underwriterFeedback, null, 2)}
            </pre>
          </div>
        )}

        {/* ── Decision controls ─────────────────────────────────── */}
        <div className="mt-8">
          <UnderwriterDecisionForm
            dealId={dealId}
            snapshotId={snapshotId}
            currentStatus={status}
          />
        </div>
      </div>
    </div>
  );
}

function SectionBlock({ section }: { section: FloridaArmorySection }) {
  return (
    <section className="rounded-md border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900 mb-1">{section.title}</h2>
      {section.narrative && (
        <p className="text-sm text-gray-800 whitespace-pre-wrap mb-3">{section.narrative}</p>
      )}
      {section.tables.map((t) => (
        <div key={t.key} className="mb-3 overflow-x-auto">
          <div className="text-[11px] font-semibold text-gray-600 uppercase mb-1">{t.title}</div>
          {t.rows.length === 0 ? (
            <div className="text-[11px] text-gray-400 italic">No rows.</div>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  {t.columns.map((c) => (
                    <th key={c} className="text-left text-gray-500 font-semibold px-2 py-1">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {t.columns.map((col) => (
                      <td key={col} className="px-2 py-1 text-gray-800">
                        {formatCell((row as Record<string, unknown>)[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {section.warnings.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-700">
          {section.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
      {section.citations.length > 0 && (
        <div className="mt-2 text-[10px] text-gray-500">
          Cited sources: {section.citations.length}
        </div>
      )}
    </section>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value);
}
