// src/components/deals/interview/LiveDocumentChecklistCard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { DOC_KEY_TO_TYPES } from "@/lib/interview/docEvidenceMap";
import { getChecklistRule, normalizeLoanType } from "@/lib/interview/docChecklist";

type Fact = {
  id: string;
  field_key: string;
  field_value: any;
  confirmed: boolean;
};

type EvidenceFile = {
  file_id: string;
  uploaded_at: string | null;
  mime_type: string | null;
  name: string | null;
  ocr_status: string | null;
  classify_status: string | null;
  doc_type: string | null;
  doc_confidence: number | null;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url, { method: "GET" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(j?.error || `request_failed_${r.status}`);
  return j as T;
}

function badge(label: string, tone: "ok" | "warn" | "muted") {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
      : tone === "warn"
      ? "bg-amber-500/15 text-amber-700 border-amber-500/30"
      : "bg-muted text-muted-foreground";
  return <span className={cx("rounded-full border px-2 py-0.5 text-xs", cls)}>{label}</span>;
}

function statusFromFile(f: EvidenceFile) {
  const ocr = (f.ocr_status || "").toLowerCase();
  const cls = (f.classify_status || "").toLowerCase();
  const hasType = !!f.doc_type && f.doc_type !== "UNKNOWN";

  if (hasType) return { label: "Classified", tone: "ok" as const };
  if (cls && cls !== "succeeded") return { label: "Classifying", tone: "warn" as const };
  if (ocr && ocr !== "succeeded") return { label: "OCR Processing", tone: "warn" as const };
  return { label: "Uploaded", tone: "muted" as const };
}

export default function LiveDocumentChecklistCard({
  dealId,
  facts,
  pollMs = 6000,
  onOpenUpload,
}: {
  dealId: string;
  facts: Fact[];
  pollMs?: number;
  onOpenUpload?: () => void;
}) {
  const confirmedLoanTypeRaw = useMemo(() => {
    const f = facts.find((x) => x.confirmed && x.field_key === "loan_type_requested");
    return f?.field_value ?? null;
  }, [facts]);

  const rule = useMemo(() => getChecklistRule(normalizeLoanType(confirmedLoanTypeRaw)), [confirmedLoanTypeRaw]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [files, setFiles] = useState<EvidenceFile[]>([]);

  async function refresh() {
    try {
      setErr("");
      const out = await api<{ files: EvidenceFile[] }>(`/api/deals/${dealId}/documents/evidence`);
      setFiles(Array.isArray(out.files) ? out.files : []);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(() => refresh(), pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, pollMs]);

  const docsStatus = useMemo(() => {
    // For each checklist doc item, match evidence by doc_type (if classified),
    // otherwise fallback to any file present as "uploaded" only if no mapping.
    const map: Record<
      string,
      {
        key: string;
        required: boolean;
        label: string;
        matched: EvidenceFile[];
        state: "missing" | "uploaded" | "processing" | "classified";
      }
    > = {};

    for (const d of rule.docs) {
      const types = DOC_KEY_TO_TYPES[d.key] || [];
      const matched = files.filter((f) => {
        if (!types.length) return false;
        const dt = f.doc_type || "UNKNOWN";
        return types.includes(dt);
      });

      // Determine state
      let state: "missing" | "uploaded" | "processing" | "classified" = "missing";
      if (matched.length > 0) {
        const anyClassified = matched.some((f) => !!f.doc_type && f.doc_type !== "UNKNOWN");
        const anyProcessing = matched.some((f) => {
          const o = (f.ocr_status || "").toLowerCase();
          const c = (f.classify_status || "").toLowerCase();
          return (o && o !== "succeeded") || (c && c !== "succeeded");
        });
        state = anyClassified ? "classified" : anyProcessing ? "processing" : "uploaded";
      }

      map[d.key] = { key: d.key, required: d.required, label: d.label, matched, state };
    }

    return map;
  }, [rule.docs, files]);

  const requiredDocs = useMemo(() => rule.docs.filter((d) => d.required), [rule.docs]);

  const requiredDocsDone = useMemo(() => {
    const done = requiredDocs.filter((d) => docsStatus[d.key]?.state === "classified" || docsStatus[d.key]?.state === "uploaded" || docsStatus[d.key]?.state === "processing").length;
    return { done, required: requiredDocs.length };
  }, [requiredDocs, docsStatus]);

  const missingRequiredDocs = useMemo(() => {
    return requiredDocs
      .filter((d) => docsStatus[d.key]?.state === "missing")
      .map((d) => ({ key: d.key, label: d.label }));
  }, [requiredDocs, docsStatus]);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Documents Checklist (Live)</div>
          <div className="text-xs text-muted-foreground">
            Status is based on uploads + OCR/classification evidence. Underwriting uses verified docs.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">
            Required docs:{" "}
            <span className="font-medium text-foreground">
              {requiredDocsDone.done}/{requiredDocsDone.required}
            </span>
          </div>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            onClick={() => onOpenUpload?.()}
          >
            Upload documents
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <div className="font-medium">Evidence adapter error</div>
          <div className="mt-1 font-mono text-xs">{err}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            If uploads/jobs are in different tables, adjust the adapter route at{" "}
            <span className="font-mono">/api/deals/[dealId]/documents/evidence</span>.
          </div>
        </div>
      ) : null}

      {missingRequiredDocs.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Missing required documents</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground space-y-1">
            {missingRequiredDocs.map((d) => (
              <li key={d.key}>{d.label}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">✅ Required documents have been uploaded (or are processing).</div>
      )}

      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">Checklist items</div>

        <div className="mt-3 space-y-2">
          {rule.docs.map((d) => {
            const st = docsStatus[d.key];
            const tone =
              st?.state === "classified" ? ("ok" as const) : st?.state === "processing" ? ("warn" as const) : st?.state === "uploaded" ? ("muted" as const) : ("warn" as const);
            const label =
              st?.state === "classified"
                ? "Classified"
                : st?.state === "processing"
                ? "Processing"
                : st?.state === "uploaded"
                ? "Uploaded"
                : d.required
                ? "Missing"
                : "Optional";

            return (
              <div key={d.key} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{d.key}</span>
                      {badge(label, st?.state === "missing" && d.required ? "warn" : tone)}
                      {d.required ? badge("required", "warn") : badge("optional", "muted")}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{d.label}</div>
                  </div>
                </div>

                {st?.matched?.length ? (
                  <div className="mt-3 rounded-md border bg-muted/20 p-3">
                    <div className="text-xs font-medium text-muted-foreground">Evidence files</div>
                    <div className="mt-2 space-y-2">
                      {st.matched.slice(0, 5).map((f) => {
                        const s = statusFromFile(f);
                        return (
                          <div key={f.file_id} className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm">{f.name || f.file_id}</div>
                              <div className="text-[11px] text-muted-foreground">
                                doc_type: <span className="font-mono">{f.doc_type || "UNKNOWN"}</span>
                                {typeof f.doc_confidence === "number" ? (
                                  <>
                                    {" "}
                                    • conf: <span className="font-mono">{f.doc_confidence.toFixed(2)}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                            <div>{badge(s.label, s.tone)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          Note: "Classified" indicates Buddy's document classifier recognized the document type. Verification still requires human/lender policy review.
        </div>
      </div>

      {loading ? <div className="text-sm text-muted-foreground">Loading document evidence…</div> : null}
    </div>
  );
}
