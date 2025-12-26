"use client";

import { useEffect, useState } from "react";

type ApiResp = {
  ok: boolean;
  workerPath: string;
  absolutePath: string;
  sizeBytes: number;
};

export default function PdfWorkerDebugPage() {
  const [api, setApi] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [workerStatus, setWorkerStatus] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/debug/pdf-worker", { cache: "no-store" });
        const j = (await r.json()) as ApiResp;
        setApi(j);

        const url = `${window.location.origin}${j.workerPath}`;
        const wr = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
        setWorkerStatus(wr.status);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>PDF Worker Debug</h1>
      {err ? <pre style={{ whiteSpace: "pre-wrap" }}>{err}</pre> : null}
      <pre style={{ whiteSpace: "pre-wrap" }}>{api ? JSON.stringify(api, null, 2) : "Loading…"}</pre>
      <div>Worker fetch status: {workerStatus ?? "…"}</div>
    </main>
  );
}
