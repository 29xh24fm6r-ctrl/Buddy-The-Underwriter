// src/components/borrower/hooks/usePortalUpload.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { PortalUploadResponse, PortalActivityEvent } from "@/lib/borrower/portalTypes";
import { uploadBorrowerFile } from "@/lib/uploads/uploadFile";

type UploadState =
  | { status: "idle"; error: null; last: null }
  | { status: "uploading"; error: null; last: null }
  | { status: "success"; error: null; last: PortalUploadResponse }
  | { status: "error"; error: string; last: null };

export type UploadQueueItem = {
  id: string;
  filename: string;
  bytes?: number;
  mime?: string;
  file?: File; // retained in-memory for retry
  state: "queued" | "uploading" | "uploaded" | "failed";
  message?: string;
};

export type UploadProgress = {
  pct: number; // 0..100
  loaded: number;
  total: number;
  rateBps?: number;
  etaSec?: number;
};

export type UploadHints = {
  hinted_doc_type?: string | null;
  hinted_category?: string | null;
};

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function nowIso() {
  return new Date().toISOString();
}

function xhrUploadJsonWithController(url: string, form: FormData, onProgress?: (p: UploadProgress) => void) {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<{ status: number; json: any }>((resolve, reject) => {
    let lastTs = Date.now();
    let lastLoaded = 0;

    xhr.open("POST", url, true);

    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const loaded = evt.loaded;
      const total = evt.total;
      const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;

      const now = Date.now();
      const dt = Math.max(1, now - lastTs) / 1000;
      const dbytes = loaded - lastLoaded;
      const rateBps = dbytes / dt;

      const remaining = Math.max(0, total - loaded);
      const etaSec = rateBps > 1 ? remaining / rateBps : undefined;

      lastTs = now;
      lastLoaded = loaded;

      onProgress?.({
        pct: clamp(pct, 0, 100),
        loaded,
        total,
        rateBps: Number.isFinite(rateBps) ? rateBps : undefined,
        etaSec: Number.isFinite(etaSec ?? NaN) ? etaSec : undefined,
      });
    };

    xhr.onerror = () => reject(new Error("network_error"));
    xhr.onabort = () => reject(new Error("upload_aborted"));

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      const status = xhr.status || 0;
      const text = xhr.responseText || "";
      try {
        const json = text ? JSON.parse(text) : null;
        resolve({ status, json });
      } catch {
        reject(new Error(text || `Upload failed (${status})`));
      }
    };

    xhr.send(form);
  });

  return {
    promise,
    abort: () => {
      try {
        xhr.abort();
      } catch {
        // ignore
      }
    },
  };
}

export function usePortalUpload(token: string) {
  const [state, setState] = useState<UploadState>({ status: "idle", error: null, last: null });
  const [localActivity, setLocalActivity] = useState<PortalActivityEvent[]>([]);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const abortRef = useRef<null | (() => void)>(null);

  const uploadFiles = useCallback(
    async (files: FileList | File[], hints?: UploadHints) => {
      if (!token) {
        setState({ status: "error", error: "Missing portal token", last: null });
        return;
      }

      const list = Array.from(files || []);
      if (list.length === 0) return;

      const q = list.map((f) => ({
        id: makeId(),
        filename: f.name || "upload",
        bytes: f.size,
        mime: f.type || "",
        file: f,
        state: "queued" as const,
        message: "Ready",
      }));

      setQueue(q);
      setProgress({ pct: 0, loaded: 0, total: list.reduce((s, f) => s + (f.size || 0), 0) });
      setState({ status: "uploading", error: null, last: null });

      try {
        // Upload files sequentially using canonical uploadBorrowerFile
        const results = [];
        let totalLoaded = 0;
        const totalBytes = list.reduce((s, f) => s + (f.size || 0), 0);

        for (const file of list) {
          const itemId = q.find((x) => x.filename === file.name)?.id;
          if (itemId) {
            setQueue((prev) =>
              prev.map((x) =>
                x.id === itemId ? { ...x, state: "uploading", message: "Uploading…" } : x
              )
            );
          }

          const result = await uploadBorrowerFile(
            token,
            file,
            hints?.hinted_doc_type || null,
            (pct) => {
              const fileProgress = (file.size || 0) * (pct / 100);
              const currentTotal = totalLoaded + fileProgress;
              const overallPct = totalBytes > 0 ? Math.round((currentTotal / totalBytes) * 100) : 0;
              setProgress({
                pct: overallPct,
                loaded: currentTotal,
                total: totalBytes,
              });
            }
          );

          totalLoaded += file.size || 0;

          if (result.ok) {
            results.push({ filename: file.name, success: true });
            if (itemId) {
              setQueue((prev) =>
                prev.map((x) =>
                  x.id === itemId ? { ...x, state: "uploaded", message: "Uploaded successfully" } : x
                )
              );
            }
          } else {
            results.push({ filename: file.name, success: false, error: result.error });
            if (itemId) {
              setQueue((prev) =>
                prev.map((x) =>
                  x.id === itemId ? { ...x, state: "failed", message: result.error || "Failed" } : x
                )
              );
            }
          }
        }

        const allSucceeded = results.every((r) => r.success);
        if (allSucceeded) {
          setState({ status: "success", error: null, last: { ok: true } as any });
          setLocalActivity((prev) => [
            { kind: "NOTE", message: "Upload complete.", created_at: nowIso() },
            ...prev,
          ].slice(0, 12));
        } else {
          const failedCount = results.filter((r) => !r.success).length;
          setState({ status: "error", error: `${failedCount} file(s) failed`, last: null });
        }

        setProgress((p) => (p ? { ...p, pct: 100 } : { pct: 100, loaded: 1, total: 1 }));
      } catch (e: any) {
        abortRef.current = null;

        console.error("[usePortalUpload] uploadFiles failed:", e?.message || e);

        if (e?.message === "upload_aborted") {
          setState({ status: "idle", error: null, last: null });
          setProgress(null);
          setQueue((prev) => prev.map((x) => ({ ...x, state: "failed", message: "Canceled" })));
          setLocalActivity((prev) => [{ kind: "NOTE", message: "Upload canceled.", created_at: nowIso() }, ...prev].slice(0, 12));
          return;
        }

        setState({ status: "error", error: e?.message || "Upload failed", last: null });
        setQueue((prev) => prev.map((x) => ({ ...x, state: "failed", message: "Failed" })));
        setProgress(null);
      }
    },
    [token]
  );

  const retryFailed = useCallback(
    async (hints?: UploadHints) => {
      const failedFiles = queue.filter((q) => q.state === "failed" && q.file).map((q) => q.file!) as File[];
      if (failedFiles.length === 0) return;
      await uploadFiles(failedFiles, hints);
    },
    [queue, uploadFiles]
  );

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    setState({ status: "idle", error: null, last: null });
    setLocalActivity([]);
    setQueue([]);
    setProgress(null);
    abortRef.current = null;
  }, []);

  const summary = useMemo(() => {
    const total = queue.length;
    const uploaded = queue.filter((q) => q.state === "uploaded").length;
    const failed = queue.filter((q) => q.state === "failed").length;
    const uploading = queue.some((q) => q.state === "uploading");
    return { total, uploaded, failed, uploading };
  }, [queue]);

  return { state, uploadFiles, retryFailed, clear, cancel, localActivity, queue, summary, progress };
}
