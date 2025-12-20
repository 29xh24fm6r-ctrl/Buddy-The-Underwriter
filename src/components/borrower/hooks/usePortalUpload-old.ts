// src/components/borrower/hooks/usePortalUpload.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { PortalUploadResponse, PortalActivityEvent } from "@/lib/borrower/portalTypes";

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
  state: "queued" | "uploading" | "uploaded" | "failed";
  message?: string;
};

export type UploadProgress = {
  pct: number; // 0..100
  loaded: number;
  total: number;
  rateBps?: number; // best-effort
  etaSec?: number; // best-effort
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

function buildLocalActivityFromBatch(resp: PortalUploadResponse): PortalActivityEvent[] {
  if (Array.isArray(resp.activity) && resp.activity.length) return resp.activity;

  const uploaded = Array.isArray((resp as any)?.uploaded) ? (resp as any).uploaded : [];
  const n = uploaded.length || (resp as any)?.uploaded_count || 0;

  if (n > 0) {
    return [
      { kind: "UPLOAD_RECEIVED", message: `Received ${n} file${n === 1 ? "" : "s"}.`, created_at: nowIso() },
      { kind: "NOTE", message: "We're organizing and labeling everything automatically.", created_at: nowIso() },
    ];
  }

  return [{ kind: "UPLOAD_RECEIVED", message: "Upload received.", created_at: nowIso() }];
}

function xhrUploadJsonWithController(
  url: string,
  form: FormData,
  onProgress?: (p: UploadProgress) => void
) {
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

      // best-effort rate/eta
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
    async (files: FileList | File[]) => {
      if (!token) {
        setState({ status: "error", error: "Missing portal token", last: null });
        return;
      }

      const list = Array.from(files || []);
      if (list.length === 0) return;

      // queue immediately
      const q = list.map((f) => ({
        id: makeId(),
        filename: f.name || "upload",
        bytes: f.size,
        mime: f.type || "",
        state: "queued" as const,
        message: "Ready",
      }));
      setQueue(q);

      setProgress({
        pct: 0,
        loaded: 0,
        total: list.reduce((s, f) => s + (f.size || 0), 0),
      });

      setState({ status: "uploading", error: null, last: null });

      try {
        // mark all as uploading (single batch POST)
        setQueue((prev) => prev.map((x) => ({ ...x, state: "uploading", message: "Uploading…" })));

        const fd = new FormData();
        for (const f of list) fd.append("files", f, f.name);

        const url = `/api/borrower/portal/upload?token=${encodeURIComponent(token)}`;

        const { promise, abort } = xhrUploadJsonWithController(url, fd, (p) => setProgress(p));
        abortRef.current = abort;

        const { status, json } = await promise;

        abortRef.current = null;

        if (!status || status < 200 || status >= 300 || !json?.ok) {
          throw new Error(json?.error || `Upload failed (${status || "0"})`);
        }

        setState({ status: "success", error: null, last: json as PortalUploadResponse });
        setProgress((p) => (p ? { ...p, pct: 100 } : { pct: 100, loaded: 1, total: 1 }));

        // mark queue as uploaded with best-effort per-file labeling
        const serverUploaded = Array.isArray((json as any)?.uploaded) ? (json as any).uploaded : null;

        if (serverUploaded && serverUploaded.length) {
          const byName = new Map<string, any[]>();
          for (const u of serverUploaded) {
            const name = String(u.filename || u.original_name || "");
            if (!byName.has(name)) byName.set(name, []);
            byName.get(name)!.push(u);
          }

          setQueue((prev) =>
            prev.map((item) => {
              const hits = byName.get(item.filename);
              const best = hits?.[0];
              const matched = !!best?.matched;
              return {
                ...item,
                state: "uploaded",
                message: matched ? "Filed automatically" : "Received — organizing",
              };
            })
          );
        } else {
          setQueue((prev) => prev.map((x) => ({ ...x, state: "uploaded", message: "Received" })));
        }

        const evts = buildLocalActivityFromBatch(json as PortalUploadResponse);
        setLocalActivity((prev) => [...evts, ...prev].slice(0, 10));
      } catch (e: any) {
        abortRef.current = null;

        const msg = e?.message || "Upload failed";

        if (msg === "upload_aborted") {
          setState({ status: "idle", error: null, last: null });
          setProgress(null);
          setQueue((prev) => prev.map((x) => ({ ...x, state: "failed", message: "Canceled" })));
          setLocalActivity((prev) => [
            { kind: "NOTE", message: "Upload canceled.", created_at: nowIso() },
            ...prev,
          ].slice(0, 10));
          return;
        }

        setState({ status: "error", error: msg, last: null });
        setQueue((prev) => prev.map((x) => ({ ...x, state: "failed", message: "Failed" })));
        setProgress(null);
      }
    },
    [token]
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

  return { state, uploadFiles, clear, cancel, localActivity, queue, summary, progress };
}
