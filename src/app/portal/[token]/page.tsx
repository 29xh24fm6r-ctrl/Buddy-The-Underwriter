"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type ReqRow = {
  id: string;
  title: string;
  category: string | null;
  doc_type: string | null;
  status: string;
  updated_at?: string | null;
  received_at?: string | null;
};

type UploadItem = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error" | "canceled";
  progress: number;
  error?: string;
  matched?: boolean;
  confidence?: number | null;
  reason?: string | null;
  requestId?: string | null;
};

type TimelineStep = {
  id: "upload" | "review" | "uw" | "approval" | "closing";
  title: string;
  subtitle: string;
  state: "done" | "current" | "upcoming";
};

type PortalStatus = {
  ok: boolean;
  checklist: { total: number; received: number; missing: number; pct: number };
  stage: string;
  timeline: TimelineStep[];
  eta: { banker_review_by: string | null };
  progress: number;
  updated_at: string;
  error?: string;
};

function formatBytes(n?: number) {
  if (!n || n <= 0) return "";
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function norm(s?: string | null) {
  return String(s || "").trim().toLowerCase();
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function statusIsReceived(status?: string | null) {
  const s = norm(status);
  return s === "received" || s === "complete" || s === "done";
}

function summarizeChecklist(reqs: ReqRow[]) {
  const total = reqs.length;
  const received = reqs.filter((r) => statusIsReceived(r.status)).length;
  const missing = total - received;
  const pct = total > 0 ? Math.round((received / total) * 100) : 0;
  return { total, received, missing, pct };
}

function groupByCategory(reqs: ReqRow[]) {
  const map = new Map<string, ReqRow[]>();
  for (const r of reqs) {
    const key = (r.category || "Other").trim() || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
  return keys.map((k) => ({ category: k, rows: map.get(k)! }));
}

function makeConfettiPieces(count: number) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const left = Math.round(Math.random() * 100);
    const delay = Math.random() * 0.2;
    const dur = 1.4 + Math.random() * 0.8;
    const rot = Math.round(Math.random() * 360);
    const size = 6 + Math.round(Math.random() * 6);
    const drift = (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 60);
    pieces.push({ id: `c_${Date.now()}_${i}_${Math.random().toString(16).slice(2)}`, left, delay, dur, rot, size, drift });
  }
  return pieces;
}

function prettyDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function stepDotClass(state: TimelineStep["state"]) {
  if (state === "done") return "bg-foreground";
  if (state === "current") return "bg-foreground ring-4 ring-foreground/20";
  return "bg-muted-foreground/30";
}

function stepTextClass(state: TimelineStep["state"]) {
  if (state === "done") return "text-foreground";
  if (state === "current") return "text-foreground";
  return "text-muted-foreground";
}

export default function BorrowerPortalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  // ---------- Customize these CTAs (safe defaults) ----------
  const PRIMARY_CTA_TEXT = "Schedule a quick call";
  const PRIMARY_CTA_HREF = "#"; // replace with your scheduler link or portal next step
  const SECONDARY_CTA_TEXT = "Message my banker";
  const SECONDARY_CTA_HREF = "#"; // replace with your portal message page route

  // ---------- live checklist ----------
  const [requests, setRequests] = useState<ReqRow[]>([]);
  const [reqLoading, setReqLoading] = useState(true);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // ---------- status timeline ----------
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // ---------- uploader ----------
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const xhrById = useRef<Record<string, XMLHttpRequest | null>>({});
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  // ---------- "You're done!" moment ----------
  const [celebrateArmed, setCelebrateArmed] = useState(false);
  const [celebrateFired, setCelebrateFired] = useState(false);
  const [confetti, setConfetti] = useState<Array<{ id: string; left: number; delay: number; dur: number; rot: number; size: number; drift: number }>>(
    []
  );

  const queuedCount = useMemo(() => items.filter((x) => x.status === "queued").length, [items]);
  const uploadingCount = useMemo(() => items.filter((x) => x.status === "uploading").length, [items]);
  const doneCount = useMemo(() => items.filter((x) => x.status === "done").length, [items]);
  const errorCount = useMemo(() => items.filter((x) => x.status === "error").length, [items]);

  const checklist = useMemo(() => summarizeChecklist(requests), [requests]);
  const grouped = useMemo(() => groupByCategory(requests), [requests]);

  const isDone = useMemo(() => checklist.total > 0 && checklist.missing === 0, [checklist.total, checklist.missing]);

  async function loadRequests() {
    setReqErr(null);
    setReqLoading(true);

    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/requests`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load checklist");

      const reqs: ReqRow[] =
        (json.requests as ReqRow[]) ||
        (json.data?.requests as ReqRow[]) ||
        (json.document_requests as ReqRow[]) ||
        [];

      setRequests(Array.isArray(reqs) ? reqs : []);
    } catch (e: any) {
      setReqErr(e?.message || "Failed to load checklist");
    } finally {
      setReqLoading(false);
    }
  }

  async function loadStatus() {
    setStatusErr(null);
    setStatusLoading(true);

    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/status`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load status");

      setStatus(json as PortalStatus);
    } catch (e: any) {
      setStatusErr(e?.message || "Failed to load status");
    } finally {
      setStatusLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    void loadRequests();
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Poll faster while uploading; slower otherwise
  useEffect(() => {
    const fastMs = 2000;
    const slowMs = 10000;
    const ms = uploadingCount > 0 ? fastMs : slowMs;

    const t = window.setInterval(() => {
      void loadRequests();
      void loadStatus();
    }, ms);

    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadingCount, token]);

  // Arm celebration once they start doing something real (queued/uploading/done)
  useEffect(() => {
    const hasAnyActivity =
      items.some((x) => x.status === "uploading" || x.status === "done") || checklist.received > 0;
    if (hasAnyActivity) setCelebrateArmed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, checklist.received]);

  // Fire confetti once, only when done is reached after activity
  useEffect(() => {
    if (!celebrateArmed) return;
    if (!isDone) return;
    if (celebrateFired) return;

    setCelebrateFired(true);
    const pieces = makeConfettiPieces(60);
    setConfetti(pieces);

    // clear confetti after animation
    const t = window.setTimeout(() => setConfetti([]), 2600);
    return () => window.clearTimeout(t);
  }, [celebrateArmed, isDone, celebrateFired]);

  // Optimistic: if upload returns matched + requestId, immediately mark that request as received locally
  function optimisticMarkReceived(requestId: string) {
    if (!requestId) return;
    setRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? {
              ...r,
              status: "received",
              received_at: r.received_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          : r
      )
    );
  }

  // ---------- dropzone handlers ----------
  function addFiles(files: File[]) {
    const cleaned = files.filter((f) => f && f.size > 0);
    if (cleaned.length === 0) return;

    setItems((prev) => [
      ...prev,
      ...cleaned.map((file) => ({
        id: uid(),
        file,
        status: "queued" as const,
        progress: 0,
      })),
    ]);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    addFiles(files);
  }

  function cancelOne(id: string) {
    const xhr = xhrById.current[id];
    if (xhr && (xhr.readyState === 1 || xhr.readyState === 2 || xhr.readyState === 3)) {
      xhr.abort();
    }
    xhrById.current[id] = null;

    setItems((prev) =>
      prev.map((x) => (x.id === id ? { ...x, status: "canceled", progress: 0, error: undefined } : x))
    );
  }

  function cancelAll() {
    for (const it of itemsRef.current) {
      if (it.status === "uploading") cancelOne(it.id);
    }
  }

  function clearFinished() {
    setItems((prev) => prev.filter((x) => x.status === "queued" || x.status === "uploading"));
  }

  async function startUploads() {
    // sequential uploads = stable + honest progress + avoids slamming server
    const snapshot = itemsRef.current;
    for (const it of snapshot) {
      const latest = itemsRef.current;
      const current = latest.find((x) => x.id === it.id);
      if (!current || current.status !== "queued") continue;
      await uploadOne(it.id, it.file);
    }
  }

  function uploadOne(id: string, file: File) {
    return new Promise<void>((resolve) => {
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: "uploading", progress: 1 } : x)));

      const xhr = new XMLHttpRequest();
      xhrById.current[id] = xhr;

      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const pct = clamp(Math.round((evt.loaded / evt.total) * 100), 1, 99);
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, progress: pct } : x)));
      };

      xhr.onerror = () => {
        if (itemsRef.current.find((x) => x.id === id)?.status === "canceled") return resolve();

        setItems((prev) =>
          prev.map((x) => (x.id === id ? { ...x, status: "error", progress: 0, error: "network_error" } : x))
        );
        xhrById.current[id] = null;
        resolve();
      };

      xhr.onabort = () => {
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: "canceled", progress: 0 } : x)));
        xhrById.current[id] = null;
        resolve();
      };

      xhr.onload = () => {
        const text = xhr.responseText || "";
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {}

        if (!json?.ok) {
          setItems((prev) =>
            prev.map((x) =>
              x.id === id ? { ...x, status: "error", progress: 0, error: String(json?.error || "upload_failed") } : x
            )
          );
          xhrById.current[id] = null;
          return resolve();
        }

        const r = Array.isArray(json?.results) ? json.results[0] : null;

        const matched = !!r?.matched;
        const requestId = r?.match?.requestId ? String(r.match.requestId) : null;
        const confidence = r?.match?.confidence ?? null;
        const reason = r?.match?.reason ?? null;

        setItems((prev) =>
          prev.map((x) =>
            x.id === id ? { ...x, status: "done", progress: 100, matched, requestId, confidence, reason } : x
          )
        );

        if (matched && requestId) optimisticMarkReceived(requestId);

        xhrById.current[id] = null;

        // reconcile with server truth
        void loadRequests();
        void loadStatus();

        resolve();
      };

      const form = new FormData();
      form.append("files", file);

      xhr.open("POST", `/api/portal/${encodeURIComponent(token)}/upload`, true);
      xhr.send(form);
    });
  }

  return (
    <div className="relative mx-auto max-w-4xl space-y-6 p-6">
      {/* Confetti overlay */}
      {confetti.length > 0 ? (
        <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
          {confetti.map((p) => (
            <span
              key={p.id}
              className="confetti-piece"
              style={{
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${Math.round(p.size * 1.6)}px`,
                animationDuration: `${p.dur}s`,
                animationDelay: `${p.delay}s`,
                transform: `rotate(${p.rot}deg)`,
                // @ts-ignore
                "--drift": `${p.drift}px`,
              }}
            />
          ))}
        </div>
      ) : null}

      {/* Header */}
      <div>
        <div className="text-2xl font-semibold tracking-tight">Upload your documents</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Drop everything at once. Watch your checklist clear and see the next step ETA.
        </div>
      </div>

      {/* STATUS TIMELINE + ETA */}
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Status timeline</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {statusLoading ? (
                "Loading status…"
              ) : statusErr ? (
                <span className="text-red-600">{statusErr}</span>
              ) : status ? (
                <>
                  Progress{" "}
                  <span className="font-semibold text-foreground">{clamp(status.progress, 0, 100)}%</span>
                  {status.eta?.banker_review_by ? (
                    <>
                      {" "}
                      · Estimated banker update by{" "}
                      <span className="font-semibold text-foreground">{prettyDateTime(status.eta.banker_review_by)}</span>
                    </>
                  ) : null}
                </>
              ) : (
                "—"
              )}
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full border">
              <div className="h-full bg-foreground" style={{ width: `${clamp(status?.progress || 0, 0, 100)}%` }} />
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              {uploadingCount > 0 ? (
                <>
                  Uploading <span className="font-semibold text-foreground">{uploadingCount}</span> file(s)…
                </>
              ) : isDone ? (
                "All required documents received."
              ) : (
                "Keep uploading — the system will auto-check off what it can."
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"
              onClick={() => void loadStatus()}
              disabled={statusLoading}
            >
              {statusLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Timeline rail */}
        <div className="mt-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {(status?.timeline || [
              { id: "upload", title: "Upload documents", subtitle: "Drag & drop everything you have", state: "current" as const },
              { id: "review", title: "Bank review", subtitle: "We check completeness + match items", state: "upcoming" as const },
              { id: "uw", title: "Underwriting", subtitle: "Credit team reviews the request", state: "upcoming" as const },
              { id: "approval", title: "Approval", subtitle: "Decision + terms confirmed", state: "upcoming" as const },
              { id: "closing", title: "Closing", subtitle: "Docs signed and funding scheduled", state: "upcoming" as const },
            ]).map((s) => (
              <div key={s.id} className="rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <div className={`mt-1 h-3 w-3 rounded-full ${stepDotClass(s.state)}`} />
                  <div className="min-w-0">
                    <div className={`text-sm font-semibold ${stepTextClass(s.state)}`}>{s.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{s.subtitle}</div>
                    <div className="mt-2 text-[11px] font-semibold text-muted-foreground">
                      {s.state === "done" ? "Done" : s.state === "current" ? "In progress" : "Up next"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {isDone && !statusLoading ? (
            <div className="mt-4 rounded-xl border p-4">
              <div className="text-sm font-semibold">You're done ✅</div>
              <div className="mt-1 text-sm text-muted-foreground">
                We received all required docs. Next, we review and move you into underwriting.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={PRIMARY_CTA_HREF}
                  className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90"
                >
                  {PRIMARY_CTA_TEXT}
                </a>
                <a href={SECONDARY_CTA_HREF} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">
                  {SECONDARY_CTA_TEXT}
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* LIVE CHECKLIST CARD */}
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Live checklist</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {reqLoading ? (
                "Loading required items…"
              ) : reqErr ? (
                <span className="text-red-600">{reqErr}</span>
              ) : checklist.total === 0 ? (
                "No required items found."
              ) : (
                <>
                  Missing{" "}
                  <span className="font-semibold text-foreground">{checklist.missing}</span> · Received{" "}
                  <span className="font-semibold text-foreground">{checklist.received}</span> · Total{" "}
                  <span className="font-semibold text-foreground">{checklist.total}</span>
                </>
              )}
            </div>

            {/* True progress bar */}
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full border">
              <div className="h-full bg-foreground" style={{ width: `${clamp(checklist.pct, 0, 100)}%` }} />
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              Progress: <span className="font-semibold text-foreground">{checklist.pct}%</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"
              onClick={() => void loadRequests()}
              disabled={reqLoading}
              title="Refresh checklist"
            >
              {reqLoading ? "Refreshing…" : "Refresh"}
            </button>

            <button
              className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide details" : "Show details"}
            </button>
          </div>
        </div>

        {/* Details */}
        {expanded && !reqLoading && !reqErr && requests.length > 0 ? (
          <div className="mt-4 space-y-3">
            {grouped.map((g) => {
              const total = g.rows.length;
              const received = g.rows.filter((r) => statusIsReceived(r.status)).length;
              const missing = total - received;
              const pct = total > 0 ? Math.round((received / total) * 100) : 0;

              return (
                <div key={g.category} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{g.category}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Missing <span className="font-semibold text-foreground">{missing}</span> · Received{" "}
                        <span className="font-semibold text-foreground">{received}</span> · Total{" "}
                        <span className="font-semibold text-foreground">{total}</span>
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground">{pct}%</div>
                  </div>

                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full border">
                    <div className="h-full bg-foreground" style={{ width: `${clamp(pct, 0, 100)}%` }} />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {g.rows.slice(0, 12).map((r) => {
                      const received = statusIsReceived(r.status);
                      return (
                        <div key={r.id} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold">{r.title}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{r.doc_type ? r.doc_type : "—"}</div>
                          </div>
                          <div className={["rounded-full border px-2 py-1 text-[11px] font-semibold", received ? "text-foreground" : "text-muted-foreground"].join(" ")}>
                            {received ? "Received" : "Missing"}
                          </div>
                        </div>
                      );
                    })}
                    {g.rows.length > 12 ? (
                      <div className="rounded-xl border p-3 text-xs text-muted-foreground">+{g.rows.length - 12} more in this category</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Dropzone */}
      <div
        className={[
          "rounded-2xl border bg-white p-6 shadow-sm transition",
          dragOver ? "ring-2 ring-foreground" : "",
        ].join(" ")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold">Drop files here</div>
            <div className="mt-1 text-sm text-muted-foreground">
              PDFs, images, spreadsheets — bulk upload supported.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted">
              Choose files
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => addFiles(Array.from(e.target.files || []))}
              />
            </label>

            <button
              className="rounded-xl bg-foreground px-3 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-60"
              onClick={() => void startUploads()}
              disabled={queuedCount === 0 || uploadingCount > 0}
              title="Start uploading all queued files"
            >
              Upload {queuedCount > 0 ? `(${queuedCount})` : ""}
            </button>

            <button
              className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"
              onClick={cancelAll}
              disabled={uploadingCount === 0}
              title="Cancel all in-progress uploads"
            >
              Cancel all
            </button>

            <button
              className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"
              onClick={clearFinished}
              disabled={
                items.filter((x) => x.status === "done" || x.status === "error" || x.status === "canceled").length === 0
              }
              title="Remove finished items from the list"
            >
              Clear finished
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-muted-foreground md:grid-cols-4">
          <div className="rounded-xl border p-3">
            <div className="text-xs font-semibold">Queued</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{queuedCount}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs font-semibold">Uploading</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{uploadingCount}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs font-semibold">Done</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{doneCount}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs font-semibold">Errors</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{errorCount}</div>
          </div>
        </div>
      </div>

      {/* Queue */}
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold">Upload queue</div>
        <div className="mt-1 text-sm text-muted-foreground">Honest progress, cancel any file, and everything updates live.</div>

        <div className="mt-4 space-y-3">
          {items.length === 0 ? (
            <div className="rounded-xl border p-4 text-sm text-muted-foreground">No files yet. Drag & drop your folder here.</div>
          ) : (
            items.map((it) => (
              <div key={it.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{it.file.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatBytes(it.file.size)} · {it.file.type || "unknown type"}
                    </div>

                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full border">
                      <div className="h-full bg-foreground" style={{ width: `${clamp(it.progress, 0, 100)}%` }} />
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border px-2 py-1 font-semibold">{it.status.toUpperCase()}</span>
                      {it.status === "done" ? (
                        <>
                          <span className="rounded-full border px-2 py-1 font-semibold">{it.matched ? "Matched" : "Needs review"}</span>
                          {it.confidence !== null && it.confidence !== undefined ? (
                            <span className="rounded-full border px-2 py-1 font-semibold">{Math.round(Number(it.confidence))}% confidence</span>
                          ) : null}
                          {it.reason ? <span className="rounded-full border px-2 py-1 font-semibold">{it.reason}</span> : null}
                        </>
                      ) : null}
                      {it.status === "error" ? <span className="rounded-full border px-2 py-1 font-semibold">{it.error || "upload_failed"}</span> : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {it.status === "queued" ? (
                      <button className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted" onClick={() => cancelOne(it.id)}>
                        Remove
                      </button>
                    ) : null}
                    {it.status === "uploading" ? (
                      <button className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted" onClick={() => cancelOne(it.id)}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style jsx>{`
        .confetti-piece {
          position: absolute;
          top: -12px;
          background: #111;
          opacity: 0.9;
          border-radius: 2px;
          animation-name: confettiFall;
          animation-timing-function: ease-out;
          animation-fill-mode: forwards;
        }
        @keyframes confettiFall {
          0% {
            transform: translate3d(0, -10px, 0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translate3d(var(--drift), 110vh, 0) rotate(720deg);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
