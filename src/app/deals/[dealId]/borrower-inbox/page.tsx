"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type InboxRow = {
  id: string;
  filename: string;
  mime: string | null;
  bytes: number;
  storage_path: string;
  status: string;
  matched_request_id: string | null;
  match_confidence: number | null;
  match_reason: string | null;
  created_at: string | null;
};

type ReqRow = {
  id: string;
  title: string;
  category: string | null;
  doc_type: string | null;
  status: string;
};

function formatBytes(n?: number) {
  if (!n || n <= 0) return "";
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function norm(s?: string | null) {
  return String(s || "").trim().toLowerCase();
}

function isPdf(mime: string | null, filename: string) {
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf")) return true;
  return filename.toLowerCase().endsWith(".pdf");
}

function isImage(mime: string | null, filename: string) {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return true;
  const f = filename.toLowerCase();
  return f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg") || f.endsWith(".webp") || f.endsWith(".gif");
}

function Chip({ text }: { text: string }) {
  return (
    <span className="rounded-full border px-2 py-1 text-[11px] font-semibold text-muted-foreground">
      {text}
    </span>
  );
}

export default function BorrowerInboxPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [requests, setRequests] = useState<ReqRow[]>([]);

  // Controls
  const [uploadQ, setUploadQ] = useState("");
  const [minConf, setMinConf] = useState<number>(0);

  const [reqQ, setReqQ] = useState("");
  const [includeReceived, setIncludeReceived] = useState(false);
  const [reqCategory, setReqCategory] = useState<string>("");

  // suggested-only per upload
  const [suggestedOnlyByUploadId, setSuggestedOnlyByUploadId] = useState<Record<string, boolean>>({});
  function getSuggestedOnly(uploadId: string) {
    return suggestedOnlyByUploadId[uploadId] !== false;
  }
  function toggleSuggestedOnly(uploadId: string) {
    setSuggestedOnlyByUploadId((prev) => {
      const current = prev[uploadId] !== false;
      return { ...prev, [uploadId]: !current };
    });
  }

  // Preview modal
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{
    uploadInboxId: string;
    filename: string;
    mime: string | null;
    signedUrl: string;
  } | null>(null);

  // Modal attach panel state
  const [modalReqQ, setModalReqQ] = useState("");
  const [modalReqCategory, setModalReqCategory] = useState<string>("");
  const [modalIncludeReceived, setModalIncludeReceived] = useState(false);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);

  // Attach busy
  const [attachBusy, setAttachBusy] = useState<string | null>(null);

  // WOW: Auto-clear summary + undo
  const [autoBusy, setAutoBusy] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const [autoSummary, setAutoSummary] = useState<null | {
    threshold: number;
    totals: { eligible: number; attached: number; skipped: number; failed: number };
    run: { id: string; created_at: string; expires_at: string } | null;
  }>(null);

  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  function msToClock(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const u = new URL(`/api/deals/${encodeURIComponent(dealId)}/borrower/inbox`, window.location.origin);
      if (uploadQ.trim()) u.searchParams.set("q", uploadQ.trim());
      if (minConf > 0) u.searchParams.set("min_conf", String(minConf));
      if (includeReceived) u.searchParams.set("include_received", "1");
      if (reqQ.trim()) u.searchParams.set("req_q", reqQ.trim());
      if (reqCategory.trim()) u.searchParams.set("req_category", reqCategory.trim());

      const res = await fetch(u.toString(), { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load inbox");

      setInbox(json.inbox || []);
      setRequests(json.requests || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadQ, minConf, reqQ, includeReceived, reqCategory]);

  useEffect(() => {
    if (!previewOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreviewOpen(false);
        setPreview(null);
      }
    };
    window.addEventListener("keydown", onKey);

    setTimeout(() => {
      try {
        modalBodyRef.current?.focus();
      } catch {}
    }, 0);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [previewOpen]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of requests) {
      const c = (r.category || "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [requests]);

  const requestsById = useMemo(() => {
    const m = new Map<string, ReqRow>();
    for (const r of requests) m.set(r.id, r);
    return m;
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const q = norm(reqQ);
    return (requests || []).filter((r) => {
      if (!includeReceived && norm(r.status) === "received") return false;
      if (reqCategory && (r.category || "") !== reqCategory) return false;
      if (q && !norm(r.title).includes(q)) return false;
      return true;
    });
  }, [requests, reqQ, includeReceived, reqCategory]);

  function getSuggestedRequest(u: InboxRow): ReqRow | null {
    const id = u.matched_request_id;
    if (id && requestsById.has(id)) return requestsById.get(id)!;
    return null;
  }

  function buildSuggestedSet(u: InboxRow, reqs: ReqRow[]): ReqRow[] {
    const suggested = getSuggestedRequest(u);
    const ids = new Set<string>();
    const list: ReqRow[] = [];

    if (suggested) {
      ids.add(suggested.id);
      list.push(suggested);
    }

    const suggestedCategory = suggested?.category || null;
    if (suggestedCategory) {
      for (const r of reqs) {
        if (r.category === suggestedCategory && !ids.has(r.id)) {
          ids.add(r.id);
          list.push(r);
          if (list.length >= 5) break;
        }
      }
    }

    if (list.length < 3) {
      for (const r of reqs) {
        if (!ids.has(r.id)) {
          ids.add(r.id);
          list.push(r);
          if (list.length >= 5) break;
        }
      }
    }

    return list;
  }

  function whySuggested(upload: InboxRow, suggested: ReqRow | null) {
    if (!suggested) return "No top match yet";
    if (upload.matched_request_id === suggested.id) return "Top match from auto-match engine";
    return "Suggested by similarity";
  }

  async function attach(uploadInboxId: string, requestId: string, opts?: { closeModal?: boolean }) {
    setAttachBusy(uploadInboxId);
    setErr(null);

    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/borrower/inbox/attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ upload_inbox_id: uploadInboxId, request_id: requestId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Attach failed");

      if (opts?.closeModal) {
        setPreviewOpen(false);
        setPreview(null);
      }

      await load();
    } catch (e: any) {
      setErr(e?.message || "Attach failed");
    } finally {
      setAttachBusy(null);
    }
  }

  async function openPreviewModal(upload: InboxRow) {
    setPreviewBusyId(upload.id);
    setErr(null);

    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/borrower/inbox/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ upload_inbox_id: upload.id }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Preview failed");

      const url = String(json.signedUrl || "");
      if (!url) throw new Error("missing_signed_url");

      setPreview({
        uploadInboxId: upload.id,
        filename: upload.filename,
        mime: upload.mime,
        signedUrl: url,
      });

      // Modal defaults
      setModalReqQ(reqQ);
      setModalReqCategory(reqCategory);
      setModalIncludeReceived(includeReceived);

      setPreviewOpen(true);
    } catch (e: any) {
      setErr(e?.message || "Preview failed");
    } finally {
      setPreviewBusyId(null);
    }
  }

  async function autoAttachBatch() {
    setAutoBusy(true);
    setErr(null);

    try {
      const threshold = 85;
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/borrower/inbox/auto-attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threshold }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Auto-clear failed");

      setAutoSummary({ threshold: json.threshold, totals: json.totals, run: json.run || null });
      await load();
    } catch (e: any) {
      setErr(e?.message || "Auto-clear failed");
    } finally {
      setAutoBusy(false);
    }
  }

  async function undoAutoClear() {
    if (!autoSummary?.run?.id) return;
    setUndoBusy(true);
    setErr(null);

    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/borrower/inbox/auto-attach/undo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run_id: autoSummary.run.id }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Undo failed");

      setAutoSummary(null);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Undo failed");
    } finally {
      setUndoBusy(false);
    }
  }

  const modalUpload: InboxRow | null = useMemo(() => {
    if (!preview) return null;
    return inbox.find((x) => x.id === preview.uploadInboxId) || null;
  }, [preview, inbox]);

  const modalSuggested: ReqRow | null = useMemo(() => {
    if (!modalUpload) return null;
    return getSuggestedRequest(modalUpload);
  }, [modalUpload, requestsById]); // eslint-disable-line react-hooks/exhaustive-deps

  const modalFilteredRequests = useMemo(() => {
    const q = norm(modalReqQ);
    return (requests || []).filter((r) => {
      if (!modalIncludeReceived && norm(r.status) === "received") return false;
      if (modalReqCategory && (r.category || "") !== modalReqCategory) return false;
      if (q && !norm(r.title).includes(q)) return false;
      return true;
    });
  }, [requests, modalReqQ, modalIncludeReceived, modalReqCategory]);

  const modalSuggestedOnly = useMemo(() => {
    if (!modalUpload) return true;
    return getSuggestedOnly(modalUpload.id);
  }, [modalUpload, suggestedOnlyByUploadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const modalAttachChoices = useMemo(() => {
    if (!modalUpload) return [];
    return modalSuggestedOnly ? buildSuggestedSet(modalUpload, modalFilteredRequests) : modalFilteredRequests.slice(0, 18);
  }, [modalUpload, modalFilteredRequests, modalSuggestedOnly]);

  const remainingCount = inbox.length;

  const undoAvailable = useMemo(() => {
    if (!autoSummary?.run?.expires_at) return false;
    return Date.parse(autoSummary.run.expires_at) > nowTick;
  }, [autoSummary, nowTick]);

  const undoCountdown = useMemo(() => {
    if (!autoSummary?.run?.expires_at) return null;
    const ms = Date.parse(autoSummary.run.expires_at) - nowTick;
    return msToClock(ms);
  }, [autoSummary, nowTick]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Summary banner with Undo */}
      {autoSummary ? (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold">Auto-Clear Complete</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Threshold: <span className="font-semibold text-foreground">{autoSummary.threshold}%</span> · Eligible{" "}
                <span className="font-semibold text-foreground">{autoSummary.totals.eligible}</span> · Attached{" "}
                <span className="font-semibold text-foreground">{autoSummary.totals.attached}</span> · Skipped{" "}
                <span className="font-semibold text-foreground">{autoSummary.totals.skipped}</span> · Failed{" "}
                <span className="font-semibold text-foreground">{autoSummary.totals.failed}</span>
              </div>

              {autoSummary.run ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  Undo window:{" "}
                  {undoAvailable ? (
                    <span className="font-semibold text-foreground">{undoCountdown} remaining</span>
                  ) : (
                    <span className="font-semibold text-foreground">expired</span>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {autoSummary.run && undoAvailable ? (
                <button
                  className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"
                  onClick={() => void undoAutoClear()}
                  disabled={undoBusy}
                  title="Undo the auto-clear batch (15 minutes)"
                >
                  {undoBusy ? "Undoing…" : `Undo (${undoCountdown})`}
                </button>
              ) : null}

              <button
                className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted"
                onClick={() => setAutoSummary(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Preview Modal (kept simple + evidence chips) */}
      {previewOpen && preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setPreviewOpen(false);
              setPreview(null);
            }
          }}
        >
          <div className="w-full max-w-6xl overflow-hidden rounded-2xl border bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{preview.filename}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {preview.mime ? preview.mime : "unknown type"} · Signed link (short-lived)
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={preview.signedUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted"
                >
                  Open
                </a>

                <button
                  type="button"
                  className="rounded-xl bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90"
                  onClick={() => {
                    setPreviewOpen(false);
                    setPreview(null);
                  }}
                  title="Close (Esc)"
                >
                  Close
                </button>
              </div>
            </div>

            <div ref={modalBodyRef} tabIndex={-1} className="outline-none">
              <div className="grid grid-cols-1 gap-0 lg:grid-cols-12">
                <div className="lg:col-span-8 border-b lg:border-b-0 lg:border-r p-4">
                  {isPdf(preview.mime, preview.filename) ? (
                    <div className="h-[72vh] w-full overflow-hidden rounded-xl border">
                      <iframe title="PDF Preview" src={preview.signedUrl} className="h-full w-full" />
                    </div>
                  ) : isImage(preview.mime, preview.filename) ? (
                    <div className="flex h-[72vh] items-center justify-center rounded-xl border bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preview.signedUrl}
                        alt={preview.filename}
                        className="max-h-[70vh] max-w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="rounded-2xl border bg-white p-6 shadow-sm">
                      <div className="text-sm font-semibold">Preview not supported</div>
                      <div className="mt-2 text-sm text-muted-foreground">Use Open to view/download.</div>
                    </div>
                  )}
                </div>

                <div className="lg:col-span-4 p-4">
                  <div className="text-sm font-semibold">Attach panel</div>
                  <div className="mt-1 text-xs text-muted-foreground">Why suggested + evidence chips</div>

                  <div className="mt-4 rounded-2xl border p-4">
                    <div className="text-xs font-semibold text-muted-foreground">Suggested</div>
                    <div className="mt-1 truncate text-sm font-semibold">
                      {modalSuggested ? modalSuggested.title : "No suggestion"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {modalUpload ? whySuggested(modalUpload, modalSuggested) : "—"}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {modalUpload && modalUpload.match_confidence !== null && modalUpload.match_confidence !== undefined ? (
                        <Chip text={`${Math.round(modalUpload.match_confidence)}% confidence`} />
                      ) : (
                        <Chip text="No confidence" />
                      )}
                      {modalUpload?.match_reason ? <Chip text={`Why: ${modalUpload.match_reason}`} /> : <Chip text="No reason" />}
                      {modalSuggested?.category ? <Chip text={`Category: ${modalSuggested.category}`} /> : null}
                      {modalSuggested?.doc_type ? <Chip text={`Doc: ${modalSuggested.doc_type}`} /> : null}
                      {modalSuggested?.status ? <Chip text={`Status: ${String(modalSuggested.status).replaceAll("_", " ")}`} /> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"
                        disabled={!modalUpload || !modalSuggested || !!attachBusy}
                        onClick={() => {
                          if (!modalUpload || !modalSuggested) return;
                          void attach(modalUpload.id, modalSuggested.id, { closeModal: true });
                        }}
                      >
                        {attachBusy && modalUpload?.id === attachBusy ? "Attaching…" : "Attach"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border p-4">
                    <div className="text-xs font-semibold text-muted-foreground">Find request</div>
                    <input
                      value={modalReqQ}
                      onChange={(e) => setModalReqQ(e.target.value)}
                      placeholder="Search requests…"
                      className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                    />

                    <div className="mt-2 grid grid-cols-1 gap-2">
                      <select
                        value={modalReqCategory}
                        onChange={(e) => setModalReqCategory(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                      >
                        <option value="">All categories</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>

                      <label className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                        <span className="text-sm">Include received</span>
                        <input
                          type="checkbox"
                          checked={modalIncludeReceived}
                          onChange={(e) => setModalIncludeReceived(e.target.checked)}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-xs font-semibold text-muted-foreground">Attach to</div>
                    <div className="mt-2 max-h-[34vh] overflow-auto rounded-2xl border p-3">
                      <div className="flex flex-col gap-2">
                        {modalAttachChoices.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            className="w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold hover:bg-muted disabled:opacity-60"
                            disabled={!modalUpload || !!attachBusy}
                            onClick={() => {
                              if (!modalUpload) return;
                              void attach(modalUpload.id, r.id, { closeModal: true });
                            }}
                          >
                            <div className="truncate">{r.title}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {r.category ? r.category : "—"} {r.doc_type ? `· ${r.doc_type}` : ""} ·{" "}
                              {String(r.status || "").replaceAll("_", " ")}
                            </div>
                          </button>
                        ))}

                        {modalAttachChoices.length === 0 ? (
                          <div className="rounded-xl border p-3 text-xs text-muted-foreground">No matching requests.</div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border bg-white p-4">
                    <div className="text-xs font-semibold text-muted-foreground">Safety</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Auto-Clear only touches uploads with confidence ≥ 85%. Undo is available for 15 minutes.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Rail */}
      <div className="sticky top-0 z-20 -mx-6 border-b bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-4 px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="rounded-full border px-3 py-1 text-xs font-semibold">
                Unmatched left: {remainingCount}
              </div>
              <div className="text-sm font-semibold">Borrower Upload Inbox</div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              One click clears the obvious. You only review the ambiguous.
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <a
              href={`/deals/${encodeURIComponent(dealId)}`}
              className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted"
            >
              Back to deal
            </a>

            <button
              className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>

            <button
              className="rounded-xl bg-foreground px-3 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-60"
              onClick={() => void autoAttachBatch()}
              disabled={autoBusy || loading || !!attachBusy || !!previewBusyId}
              title="Auto-attach all uploads with confidence ≥ 85%"
            >
              {autoBusy ? "Auto-Clearing…" : "Auto-Clear (≥85%)"}
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="text-xs font-semibold text-muted-foreground">Search uploads</div>
            <input
              value={uploadQ}
              onChange={(e) => setUploadQ(e.target.value)}
              placeholder="Search by filename…"
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
            />
            <div className="mt-2 flex items-center gap-3">
              <div className="text-xs text-muted-foreground">Min confidence</div>
              <input
                type="range"
                min={0}
                max={100}
                value={minConf}
                onChange={(e) => setMinConf(Number(e.target.value))}
                className="w-full"
              />
              <div className="w-12 text-right text-xs font-semibold">{minConf}%</div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="text-xs font-semibold text-muted-foreground">Filter requests</div>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                value={reqQ}
                onChange={(e) => setReqQ(e.target.value)}
                placeholder="Search requests…"
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />

              <select
                value={reqCategory}
                onChange={(e) => setReqCategory(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <label className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                <span className="text-sm">Include received</span>
                <input
                  type="checkbox"
                  checked={includeReceived}
                  onChange={(e) => setIncludeReceived(e.target.checked)}
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {err ? (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold">Error</div>
          <div className="mt-2 text-sm text-muted-foreground">{err}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold">Loading…</div>
          <div className="mt-2 text-sm text-muted-foreground">Fetching inbox and requests.</div>
        </div>
      ) : inbox.length === 0 ? (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold">All clear</div>
          <div className="mt-2 text-sm text-muted-foreground">No unmatched borrower uploads right now.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {inbox.map((u) => {
            const suggested = getSuggestedRequest(u);
            const suggestedOnly = getSuggestedOnly(u.id);
            const attachChoices = suggestedOnly ? buildSuggestedSet(u, filteredRequests) : filteredRequests.slice(0, 12);

            return (
              <div key={u.id} className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{u.filename}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatBytes(u.bytes)} {u.mime ? `· ${u.mime}` : ""}{" "}
                      {u.created_at ? `· ${new Date(u.created_at).toLocaleString()}` : ""}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {u.match_confidence !== null ? <Chip text={`${Math.round(u.match_confidence)}%`} /> : <Chip text="No confidence" />}
                      {u.match_reason ? <Chip text={u.match_reason} /> : <Chip text="No reason" />}
                      {suggested ? <Chip text={`Suggested: ${suggested.title}`} /> : <Chip text="No suggested request" />}
                    </div>

                    <div className="mt-2 text-xs text-muted-foreground">{whySuggested(u, suggested)}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-xl border px-3 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-60"
                      onClick={() => void openPreviewModal(u)}
                      disabled={!!attachBusy || !!previewBusyId}
                    >
                      {previewBusyId === u.id ? "Opening…" : "Preview"}
                    </button>

                    <button
                      className="rounded-xl border px-3 py-1 text-xs font-semibold hover:bg-muted"
                      onClick={() => toggleSuggestedOnly(u.id)}
                    >
                      {suggestedOnly ? "Show all" : "Suggested only"}
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-xs font-semibold text-muted-foreground">Attach to request</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attachChoices.map((r) => (
                      <button
                        key={r.id}
                        className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"
                        disabled={!!attachBusy}
                        onClick={() => void attach(u.id, r.id)}
                        title={whySuggested(u, suggested)}
                      >
                        {attachBusy === u.id ? "Attaching…" : r.title}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
