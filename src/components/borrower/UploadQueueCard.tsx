// src/components/borrower/UploadQueueCard.tsx
"use client";

import React, { useMemo } from "react";
import type { UploadQueueItem, UploadProgress } from "@/components/borrower/hooks/usePortalUpload";

function formatBytes(n?: number) {
  if (!n || n <= 0) return "";
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatRate(bps?: number) {
  if (!bps || bps <= 0) return "";
  return `${formatBytes(bps)}/s`;
}

function formatEta(sec?: number) {
  if (!sec || sec <= 0) return "";
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function pill(state: UploadQueueItem["state"]) {
  if (state === "queued") return "border bg-white";
  if (state === "uploading") return "border bg-muted/20";
  if (state === "uploaded") return "border bg-foreground text-background";
  return "border bg-white";
}

function label(state: UploadQueueItem["state"]) {
  if (state === "queued") return "Queued";
  if (state === "uploading") return "Uploading";
  if (state === "uploaded") return "Done";
  return "Failed";
}

export default function UploadQueueCard({
  queue,
  summary,
  progress,
  onCancel,
  onRetryFailed,
}: {
  queue: UploadQueueItem[];
  summary: { total: number; uploaded: number; failed: number; uploading: boolean };
  progress?: UploadProgress | null;
  onCancel?: () => void;
  onRetryFailed?: () => void;
}) {
  const rows = useMemo(() => queue.slice(0, 12), [queue]);
  const hasMore = queue.length > rows.length;

  if (!queue.length) return null;

  const pct = Math.max(0, Math.min(100, progress?.pct ?? (summary.uploading ? 5 : 100)));

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Upload queue</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {summary.uploading ? (
              <>
                Uploading <span className="font-semibold text-foreground">{summary.total}</span> file
                {summary.total === 1 ? "" : "s"}…
              </>
            ) : (
              <>
                Uploaded <span className="font-semibold text-foreground">{summary.uploaded}</span> of{" "}
                <span className="font-semibold text-foreground">{summary.total}</span>
                {summary.failed ? (
                  <>
                    {" "}
                    · <span className="font-semibold text-foreground">{summary.failed}</span> failed
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-full border px-3 py-1 text-xs font-semibold">
            {summary.uploaded}/{summary.total}
          </div>

          {summary.uploading && onCancel && (
            <button
              type="button"
              className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}

          {!summary.uploading && summary.failed > 0 && onRetryFailed && (
            <button
              type="button"
              className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted"
              onClick={onRetryFailed}
            >
              Retry failed
            </button>
          )}
        </div>
      </div>

      {/* TRUE progress bar (XHR upload progress) */}
      {summary.uploading && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{pct}%</span>
            <span>
              {progress?.loaded !== undefined && progress?.total !== undefined ? (
                <>
                  {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
                </>
              ) : null}
              {progress?.rateBps ? <span className="ml-2">· {formatRate(progress.rateBps)}</span> : null}
              {progress?.etaSec ? <span className="ml-2">· ETA {formatEta(progress.etaSec)}</span> : null}
            </span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-muted">
            <div className="h-2 rounded-full bg-foreground" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="mt-4 divide-y rounded-xl border">
        {rows.map((f) => (
          <div key={f.id} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{f.filename}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatBytes(f.bytes)}
                {f.message ? <span className="ml-2">· {f.message}</span> : null}
              </div>
            </div>

            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${pill(f.state)}`}>
              {label(f.state)}
            </span>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="mt-3 text-xs text-muted-foreground">
          Showing first {rows.length} of {queue.length} files.
        </div>
      )}
    </div>
  );
}
