"use client";

import { useCallback, useEffect, useState } from "react";
import { isActiveReviewActionStatus } from "@/lib/classicSpread/review/reviewActionStatus";
import type { SourceEvidenceStatus } from "@/lib/classicSpread/review/sourceEvidenceStatus";

/**
 * SPEC-CLASSIC-SPREAD-BANKER-REVIEW-ACTIONS-1 #4 — compact "Spread Review Actions" panel.
 *
 * Lists the open blocker actions from the latest Classic Spread audit and lets a banker confirm
 * Buddy's resolved value, verify the source line, request borrower detail, or waive with a note.
 * All workflow goes through the single /classic-spread/review-actions route.
 */

type ReviewAction = {
  id: string;
  period_label: string;
  statement: string;
  row_label: string;
  action_type: string;
  issue_type: string;
  severity: string;
  status: string;
  recommended_value: number | null;
  source_value: number | null;
  diff_value: number | null;
  source_document_id: string | null;
  reviewer_note: string | null;
  // SPEC-SPREAD-SOURCE-EVIDENCE-CLEARING-WORKFLOW-1: evidence lifecycle for active source-detail/verify
  // rows, computed server-side from existing documents + draft requests.
  evidence?: SourceEvidenceStatus | null;
};

const UPLOAD_LABEL: Record<string, string> = {
  no_candidate_uploaded: "No candidate uploaded",
  candidate_uploaded: "Candidate uploaded",
  candidate_uploaded_wrong_period: "Uploaded — wrong period",
  candidate_uploaded_needs_bridge: "Uploaded — bridge required",
  candidate_uploaded_extracted: "Uploaded & extracted",
};

const fmt = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  confirmed_resolved_value: "Confirmed resolved value",
  rejected_source_value: "Rejected source value",
  borrower_detail_requested: "Borrower detail requested",
  source_verified: "Source verified",
  waived: "Waived",
  closed: "Closed",
};

export default function SpreadReviewActionsPanel({ dealId }: { dealId: string }) {
  const [actions, setActions] = useState<ReviewAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const base = `/api/deals/${dealId}/classic-spread/review-actions`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) return;
      const json = (await res.json()) as { actions: ReviewAction[] };
      setActions(json.actions ?? []);
    } catch {
      /* non-fatal */
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(base, { method: "POST" });
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const json = (await res.json()) as { actions: ReviewAction[] };
      setActions(json.actions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [base]);

  const decide = useCallback(
    async (id: string, status: string) => {
      setBusyId(id);
      setError(null);
      setNotice(null);
      try {
        let note: string | null = null;
        if (status === "waived") {
          note = typeof window !== "undefined" ? window.prompt("Waiver note (required):") : null;
          if (!note) { setBusyId(null); return; }
        }
        const res = await fetch(base, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, status, note }),
        });
        if (!res.ok) throw new Error(`Decision failed (${res.status})`);
        if (status === "borrower_detail_requested") {
          const json = (await res.json().catch(() => ({}))) as {
            borrowerRequest?: { created?: boolean; alreadyRequested?: boolean } | null;
          };
          const br = json.borrowerRequest;
          const lead = br?.alreadyRequested ? "Borrower request already created" : "Borrower request created";
          setNotice(
            `${lead} — this does not resolve the review action until supporting source documentation is uploaded and the spread is regenerated.`,
          );
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [base, load],
  );

  // BUGFIX-CLASSIC-SPREAD-BORROWER-REQUESTED-STILL-OPEN-1: `borrower_detail_requested` is still an
  // ACTIVE/blocking action (request created, support not yet uploaded) — it belongs in the open list
  // with warning styling, not the reviewed/green list.
  const open = actions.filter((a) => isActiveReviewActionStatus(a.status));
  const reviewed = actions.filter((a) => !isActiveReviewActionStatus(a.status));

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Spread Review Actions</h3>
          <p className="text-xs text-white/50 mt-0.5">
            {open.length} open · {reviewed.length} reviewed — resolve each before this spread is trusted.
          </p>
        </div>
        <button
          onClick={sync}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/10 disabled:opacity-60"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>sync</span>
          {loading ? "Syncing..." : "Sync from latest audit"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">{error}</div>
      )}

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">{notice}</div>
      )}

      {open.length === 0 && reviewed.length === 0 && (
        <p className="text-xs text-white/40 py-4 text-center">No review actions. Sync from the latest audit.</p>
      )}

      {open.map((a) => (
        <div key={a.id} className="rounded-lg border border-amber-500/25 bg-amber-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-semibold text-rose-300">{a.action_type}</span>
            <span className="text-white/80 font-medium">{a.period_label}</span>
            <span className="text-white/40">·</span>
            <span className="text-white/70">{a.statement.replace(/_/g, " ")}</span>
            <span className="text-white/40">·</span>
            <span className="text-white/90 font-medium">{a.row_label}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/60">
            <span>source: <span className="text-white/80">{fmt(a.source_value)}</span></span>
            <span>recommended: <span className="text-white/80">{fmt(a.recommended_value)}</span></span>
            <span>diff: <span className="text-white/80">{fmt(a.diff_value)}</span></span>
            {a.source_document_id && <span>doc: <span className="text-white/80">{a.source_document_id.slice(0, 8)}</span></span>}
          </div>
          {a.evidence ? (
            <EvidenceStrip ev={a.evidence} />
          ) : a.status === "borrower_detail_requested" ? (
            <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-300">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_top</span>
              Borrower detail requested — awaiting upload
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <ActBtn label="Confirm Buddy resolved value" onClick={() => decide(a.id, "confirmed_resolved_value")} busy={busyId === a.id} />
            <ActBtn label="Verify source line" onClick={() => decide(a.id, "source_verified")} busy={busyId === a.id} />
            <ActBtn label="Request borrower detail" onClick={() => decide(a.id, "borrower_detail_requested")} busy={busyId === a.id} />
            <ActBtn label="Waive with note" onClick={() => decide(a.id, "waived")} busy={busyId === a.id} />
          </div>
        </div>
      ))}

      {reviewed.map((a) => (
        <div key={a.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: 15 }}>task_alt</span>
          <span className="text-white/70">{a.period_label} · {a.row_label}</span>
          <span className="text-white/40">—</span>
          <span className="text-white/80">{STATUS_LABEL[a.status] ?? a.status}</span>
          {a.reviewer_note && <span className="text-white/40 italic truncate">“{a.reviewer_note}”</span>}
        </div>
      ))}
    </div>
  );
}

function EvidenceStrip({ ev }: { ev: SourceEvidenceStatus }) {
  const toneBorder =
    ev.statusTone === "success" ? "border-emerald-500/30 bg-emerald-950/10"
      : ev.statusTone === "warning" ? "border-amber-500/30 bg-amber-950/10"
        : "border-white/10 bg-white/[0.03]";
  const reqLabel =
    ev.requestStatus === "requested" ? "Requested" : ev.requestStatus === "not_requested" ? "Not requested" : "n/a";
  return (
    <div className={`rounded-md border ${toneBorder} p-2 space-y-1.5 text-[11px]`}>
      <div className="text-white/80"><span className="text-white/45">Evidence needed:</span> {ev.requiredEvidenceSummary}</div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-white/60">
        <span><span className="text-white/40">Request:</span> {reqLabel}</span>
        <span><span className="text-white/40">Upload:</span> {UPLOAD_LABEL[ev.uploadStatus] ?? ev.uploadStatus}</span>
        <span><span className="text-white/40">Extraction:</span> {ev.extractionStatus}</span>
        <span className={ev.clearingStatus === "cleared_after_regenerate" ? "text-emerald-300" : ev.clearingStatus === "needs_regenerate" ? "text-amber-300" : "text-rose-300"}>
          {ev.clearingStatus === "cleared_after_regenerate" ? "Cleared" : ev.clearingStatus === "needs_regenerate" ? "Needs regenerate" : "Still blocking"}
        </span>
      </div>

      {ev.requestWarning && <div className="text-amber-300">{ev.requestWarning}</div>}

      {ev.matchingDocuments.length > 0 && (
        <div className="space-y-0.5">
          {ev.matchingDocuments.map((d) => (
            <div key={d.id} className="text-white/55">
              <span className="text-white/75">{d.filename}</span>
              {d.docType ? ` — ${d.docType.replace(/_/g, " ")}` : ""}
              {d.periodLabel ? ` — ${d.periodLabel}` : ""}
              {` — ${d.extractionStatus}`}
              {d.note ? <span className="text-amber-300"> — {d.note}</span> : null}
            </div>
          ))}
        </div>
      )}

      {ev.blockingReason && <div className="text-white/55"><span className="text-white/40">Why still blocking:</span> {ev.blockingReason}</div>}
      <div className="text-white/70"><span className="text-white/40">Next:</span> {ev.nextActionLabel}</div>
    </div>
  );
}

function ActBtn({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/10 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
