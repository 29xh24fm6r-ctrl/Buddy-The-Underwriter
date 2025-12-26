// src/app/borrower/portal/upload/page.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { usePortalRequests } from "@/components/borrower/hooks/usePortalRequests";
import { usePortalUpload } from "@/components/borrower/hooks/usePortalUpload";
import type { PortalActivityItem } from "@/lib/borrower/portalTypes";
import RecentActivityCard from "@/components/borrower/RecentActivityCard";
import PortalProgressCard from "@/components/borrower/PortalProgressCard";
import MissingItemsCard from "@/components/borrower/MissingItemsCard";
import UploadQueueCard from "@/components/borrower/UploadQueueCard";

export default function BorrowerPortalUploadPage() {
  const sp = useSearchParams();
  const token = useMemo(() => sp.get("token") || "", [sp]);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const { state: portalState, load, derived } = usePortalRequests(token);
  const { state: up, uploadFiles, cancel, localActivity, queue, summary, progress } = usePortalUpload(token);

  const mergedActivity = useMemo(() => {
    const server = derived?.recentActivity || [];
    // Convert local activity events to PortalActivityItem format
    const localAsItems: PortalActivityItem[] = localActivity.map((evt, idx) => ({
      id: `local-${idx}-${evt.created_at}`,
      timestamp: evt.created_at,
      type: evt.kind.toLowerCase(),
      title: evt.message,
      description: null,
      icon: evt.kind === 'UPLOAD_RECEIVED' ? 'upload' : 
            evt.kind === 'FILED' ? 'check' : 
            evt.kind === 'MATCHED' ? 'sparkles' : 'info',
    }));
    return [...localAsItems, ...server].slice(0, 10);
  }, [derived?.recentActivity, localActivity]);

  const onPick = () => fileRef.current?.click();

  const onFiles = async (files: FileList | File[]) => {
    await uploadFiles(files);
    await load(); // refresh progress/missing/packs/activity (if upload not canceled)
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Upload documents</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Drag and drop everything you have — we'll recognize and organize it automatically.
          </div>
        </div>

        <a
          href={`/borrower/portal?token=${encodeURIComponent(token)}`}
          className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted"
        >
          Back to portal
        </a>
      </div>

      {!token && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold">Missing portal token</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Please open the upload page from your secure portal link.
          </div>
        </div>
      )}

      {token && up.status === "error" && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold">Upload failed</div>
          <div className="mt-2 text-sm text-muted-foreground">{up.error}</div>
        </div>
      )}

      {token && up.status === "success" && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold">✅ Upload complete</div>
          <div className="mt-2 text-sm text-muted-foreground">
            We're organizing your documents now. You'll see updates below.
          </div>
        </div>
      )}

      {token && (
        <div
          className={[
            "rounded-2xl border bg-white p-6 shadow-sm transition",
            dragOver ? "ring-2 ring-foreground" : "",
          ].join(" ")}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            const files = e.dataTransfer.files;
            if (files && files.length) await onFiles(files);
          }}
        >
          <div className="flex flex-col items-center justify-center text-center">
            <div className="text-base font-semibold">Drop files here</div>
            <div className="mt-2 text-sm text-muted-foreground">
              PDFs, photos, scans — all good. We'll sort them for you.
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90"
                onClick={onPick}
                disabled={up.status === "uploading"}
              >
                {up.status === "uploading" ? "Uploading…" : "Choose files"}
              </button>

              <button
                type="button"
                className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted"
                onClick={() => void load()}
                disabled={portalState.status === "loading"}
              >
                {portalState.status === "loading" ? "Refreshing…" : "Refresh status"}
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = e.target.files;
                if (files && files.length) await onFiles(files);
                e.target.value = "";
              }}
            />

            <div className="mt-3 text-xs text-muted-foreground">
              Tip: If you're not sure what a document is called, upload it anyway.
            </div>
          </div>
        </div>
      )}

      {token && queue.length > 0 && (
        <UploadQueueCard
          queue={queue}
          summary={summary}
          progress={progress}
          onCancel={summary.uploading ? cancel : undefined}
        />
      )}

      {/* Guided + delight: progress, next best uploads, recent activity */}
      {token && derived && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5 space-y-6">
            <PortalProgressCard progress={derived.progress} />
            <MissingItemsCard missingItems={derived.missingItems} bestSuggestion={derived.bestSuggestion} />
          </div>

          <div className="lg:col-span-7 space-y-6">
            <RecentActivityCard activities={mergedActivity} />
          </div>
        </div>
      )}
    </div>
  );
}
