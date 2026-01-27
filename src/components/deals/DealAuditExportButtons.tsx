"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

/**
 * Client component for Phase F+G audit export actions.
 * Renders buttons for:
 * - Credit Decision Audit Export (Phase F)
 * - Examiner Drop ZIP (Phase G)
 *
 * Each button opens a confirmation modal before downloading.
 */
export function DealAuditExportButtons({
  dealId,
  decisionSnapshotId,
}: {
  dealId: string;
  decisionSnapshotId?: string | null;
}) {
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [showDropModal, setShowDropModal] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const hasSnapshot = Boolean(decisionSnapshotId);

  async function exportDecisionAudit(format: "json" | "pdf") {
    if (!decisionSnapshotId) return;
    setShowDecisionModal(false);
    setLoading(`decision-${format}`);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/decision/audit-export?snapshotId=${decisionSnapshotId}&format=${format}`,
      );
      const json = await res.json();
      if (!json.ok) {
        alert(`Export failed: ${json.error?.message ?? "unknown error"}`);
        return;
      }

      if (format === "pdf") {
        downloadBase64(json.data, json.filename, "application/pdf");
      } else {
        const blob = new Blob([JSON.stringify(json.snapshot, null, 2)], { type: "application/json" });
        downloadBlob(blob, json.filename ?? `credit-decision-audit-${dealId.slice(0, 8)}.json`);
      }
    } catch (err) {
      alert(`Export failed: ${(err as any)?.message ?? "network error"}`);
    } finally {
      setLoading(null);
    }
  }

  async function exportExaminerDrop() {
    if (!decisionSnapshotId) return;
    setShowDropModal(false);
    setLoading("examiner-drop");
    try {
      const res = await fetch(
        `/api/deals/${dealId}/examiner-drop?snapshotId=${decisionSnapshotId}`,
      );
      const json = await res.json();
      if (!json.ok) {
        alert(`Export failed: ${json.error?.message ?? "unknown error"}`);
        return;
      }

      downloadBase64(json.data, json.filename, "application/zip");
    } catch (err) {
      alert(`Export failed: ${(err as any)?.message ?? "network error"}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-2">
      {/* Credit Decision Audit Export */}
      <button
        type="button"
        disabled={!hasSnapshot || loading !== null}
        title={!hasSnapshot ? "No decision snapshot available" : "Export credit decision audit"}
        onClick={() => setShowDecisionModal(true)}
        className={
          hasSnapshot && !loading
            ? "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
            : "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900/40 px-4 py-3 text-sm font-semibold text-white/60 cursor-not-allowed"
        }
      >
        <Icon name="fact_check" className="h-4 w-4" />
        {loading?.startsWith("decision") ? "Exporting…" : "Decision Audit Export"}
      </button>

      {showDecisionModal && (
        <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-lg space-y-3">
          <div className="text-sm font-semibold text-slate-900">Export Credit Decision Audit</div>
          <div className="text-xs text-slate-600">
            This export is a regulatory artifact containing the credit decision, financial metrics,
            policy evaluation, human overrides, attestation chain, and committee record.
            No preview. Download only.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => exportDecisionAudit("pdf")}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Download PDF
            </button>
            <button
              onClick={() => exportDecisionAudit("json")}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Download JSON
            </button>
            <button
              onClick={() => setShowDecisionModal(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Examiner Drop ZIP */}
      <button
        type="button"
        disabled={!hasSnapshot || loading !== null}
        title={!hasSnapshot ? "No decision snapshot available" : "Generate examiner drop ZIP"}
        onClick={() => setShowDropModal(true)}
        className={
          hasSnapshot && !loading
            ? "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200 hover:bg-amber-500/20"
            : "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900/40 px-4 py-3 text-sm font-semibold text-white/60 cursor-not-allowed"
        }
      >
        <Icon name="description" className="h-4 w-4" />
        {loading === "examiner-drop" ? "Building ZIP…" : "Examiner Drop ZIP"}
      </button>

      {showDropModal && (
        <div className="rounded-xl border border-amber-300 bg-white p-4 shadow-lg space-y-3">
          <div className="text-sm font-semibold text-slate-900">Generate Examiner Drop Package</div>
          <div className="text-xs text-slate-600">
            This generates a complete regulatory examination package containing borrower audit,
            credit decision, financial snapshot, policy evaluation, integrity checksums, and
            a verification manifest. This is the definitive artifact for examiner review.
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportExaminerDrop}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Generate & Download ZIP
            </button>
            <button
              onClick={() => setShowDropModal(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Download helpers ────────────────────────────────────

function downloadBase64(b64: string, filename: string, mimeType: string) {
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
