"use client";

import React, { useEffect, useState } from "react";

export default function OrphansOpsPage() {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<any>(null);

  async function refresh() {
    const r = await fetch("/api/admin/orphans/latest", { cache: "no-store" });
    const j = await r.json();
    setData(j);
  }

  async function run() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/orphans/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucket: "deal-uploads", prefix: "deals/" }),
      });
      const j = await r.json();
      await refresh();
      alert(j.ok ? `Scan complete: ${j.runId}` : `Scan failed: ${j.error}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Orphan Detector</h1>
      <button
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        onClick={run}
        disabled={busy}
      >
        {busy ? "Running…" : "Run Scan Now"}
      </button>

      <pre className="text-xs bg-gray-50 border rounded p-3 overflow-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
