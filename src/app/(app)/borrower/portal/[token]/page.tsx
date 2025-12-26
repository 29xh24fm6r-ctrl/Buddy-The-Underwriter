"use client";

import React, { useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type UploadItem = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error" | "canceled";
  progress: number; // 0..100
  error?: string;
  matched?: boolean;
  confidence?: number | null;
  reason?: string | null;
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

export default function BorrowerPortalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const xhrById = useRef<Record<string, XMLHttpRequest | null>>({});

  const queuedCount = useMemo(() => items.filter((x) => x.status === "queued").length, [items]);
  const uploadingCount = useMemo(() => items.filter((x) => x.status === "uploading").length, [items]);
  const doneCount = useMemo(() => items.filter((x) => x.status === "done").length, [items]);
  const errorCount = useMemo(() => items.filter((x) => x.status === "error").length, [items]);

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
    for (const it of items) cancelOne(it.id);
  }

  function clearFinished() {
    setItems((prev) => prev.filter((x) => x.status === "queued" || x.status === "uploading"));
  }

  async function startUploads() {
    // upload sequentially to keep UX + server stable (and progress truthful)
    const snapshot = items;
    for (const it of snapshot) {
      const latest = itemsRef.current;
      const current = latest.find((x) => x.id === it.id);
      if (!current || current.status !== "queued") continue;

      await uploadOne(it.id, it.file);
    }
  }

  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  function uploadOne(id: string, file: File) {
    return new Promise<void>((resolve) => {
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: "uploading", progress: 1 } : x)));

      const xhr = new XMLHttpRequest();
      xhrById.current[id] = xhr;

      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const pct = Math.max(1, Math.min(99, Math.round((evt.loaded / evt.total) * 100)));
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, progress: pct } : x)));
      };

      xhr.onreadystatechange = () => {
        // no-op
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
              x.id === id
                ? { ...x, status: "error", progress: 0, error: String(json?.error || "upload_failed") }
                : x
            )
          );
          xhrById.current[id] = null;
          return resolve();
        }

        // Route returns { ok:true, count, results:[...] } for multi
        // When we upload single file, results will be one element
        const r = Array.isArray(json?.results) ? json.results[0] : null;
        const matched = !!r?.matched;
        const confidence = r?.match?.confidence ?? null;
        const reason = r?.match?.reason ?? null;

        setItems((prev) =>
          prev.map((x) =>
            x.id === id
              ? { ...x, status: "done", progress: 100, matched, confidence, reason }
              : x
          )
        );
        xhrById.current[id] = null;
        resolve();
      };

      const form = new FormData();
      // Send as "files" so the route can handle bulk consistently
      form.append("files", file);

      xhr.open("POST", `/api/borrower/portal/${encodeURIComponent(token)}/upload`, true);
      xhr.send(form);
    });
  }

  return (
    <div className="min-h-screen bg-[#0b0d10] text-white">
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <div className="text-2xl font-semibold tracking-tight">Upload your documents</div>
        <div className="mt-1 text-sm text-white/60">
          Drag & drop everything at once. We'll sort it and match what we can automatically.
        </div>
      </div>

      {/* Dropzone */}
      <div
        className={[
          "rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_8px_30px_rgba(0,0,0,0.35)] transition",
          dragOver ? "ring-2 ring-white/60" : "",
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
            <div className="mt-1 text-sm text-white/60">
              PDFs, images, spreadsheets, anything. Bulk upload supported.
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
              disabled={items.filter((x) => x.status === "done" || x.status === "error" || x.status === "canceled").length === 0}
              title="Remove finished items from the list"
            >
              Clear finished
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-white/60 md:grid-cols-4">
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
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
        <div className="text-sm font-semibold">Upload queue</div>
        <div className="mt-1 text-sm text-white/60">
          You can drop 30 files. We'll handle them one by one with honest progress and cancel controls.
        </div>

        <div className="mt-4 space-y-3">
          {items.length === 0 ? (
            <div className="rounded-xl border p-4 text-sm text-white/60">
              No files yet. Drag & drop your folder here.
            </div>
          ) : (
            items.map((it) => (
              <div key={it.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{it.file.name}</div>
                    <div className="mt-1 text-xs text-white/60">
                      {formatBytes(it.file.size)} · {it.file.type || "unknown type"}
                    </div>

                    {/* Progress */}
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full border">
                      <div
                        className="h-full bg-foreground"
                        style={{ width: `${Math.max(0, Math.min(100, it.progress))}%` }}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/60">
                      <span className="rounded-full border px-2 py-1 font-semibold">
                        {it.status.toUpperCase()}
                      </span>

                      {it.status === "done" ? (
                        <>
                          <span className="rounded-full border px-2 py-1 font-semibold">
                            {it.matched ? "Matched" : "Needs review"}
                          </span>
                          {it.confidence !== null && it.confidence !== undefined ? (
                            <span className="rounded-full border px-2 py-1 font-semibold">
                              {Math.round(Number(it.confidence))}% confidence
                            </span>
                          ) : null}
                          {it.reason ? (
                            <span className="rounded-full border px-2 py-1 font-semibold">
                              {it.reason}
                            </span>
                          ) : null}
                        </>
                      ) : null}

                      {it.status === "error" ? (
                        <span className="rounded-full border px-2 py-1 font-semibold">
                          {it.error || "upload_failed"}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {it.status === "queued" ? (
                      <button
                        className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted"
                        onClick={() => cancelOne(it.id)}
                      >
                        Remove
                      </button>
                    ) : null}

                    {it.status === "uploading" ? (
                      <button
                        className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted"
                        onClick={() => cancelOne(it.id)}
                      >
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

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
        <div className="text-sm font-semibold">What happens next?</div>
        <div className="mt-2 text-sm text-white/60">
          Any file with a high-confidence match is automatically checked off. Anything ambiguous lands in the banker's inbox
          for a 10-second attach decision.
        </div>
      </div>
    </div>
  </div>
  );
}
