"use client";

import { useEffect, useState } from "react";
import { pdfjs } from "react-pdf";

type Status = {
  workerUrl?: string;
  api?: any;
  fetchOk?: boolean;
  fetchStatus?: number;
  fetchError?: string;
};

export default function PdfWorkerDebugPage() {
  const [s, setS] = useState<Status>({});

  useEffect(() => {
    const run = async () => {
      const workerUrl = `${window.location.origin}/pdfjs/pdf.worker.min.mjs`;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

      const next: Status = { workerUrl };

      try {
        const r = await fetch("/api/debug/pdf-worker", { cache: "no-store" });
        next.api = await r.json();
      } catch (e: any) {
        next.api = { ok: false, error: String(e?.message ?? e) };
      }

      try {
        const r = await fetch(workerUrl, { method: "GET" });
        next.fetchOk = r.ok;
        next.fetchStatus = r.status;
      } catch (e: any) {
        next.fetchOk = false;
        next.fetchError = String(e?.message ?? e);
      }

      setS(next);
    };

    run();
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>PDF Worker Debug</h1>

      <div style={{ marginTop: 16, lineHeight: 1.6 }}>
        <div><b>workerSrc</b>: {s.workerUrl ?? "…"}</div>
        <div>
          <b>HTTP fetch</b>:{" "}
          {s.fetchOk === undefined
            ? "…"
            : s.fetchOk
              ? `OK (${s.fetchStatus})`
              : `FAIL (${s.fetchStatus ?? ""})`}
        </div>
        {s.fetchError ? <div><b>Error</b>: {s.fetchError}</div> : null}
      </div>

      <pre style={{ marginTop: 16, padding: 12, border: "1px solid #333", borderRadius: 8, overflow: "auto" }}>
{JSON.stringify(s.api ?? {}, null, 2)}
      </pre>
    </div>
  );
}
