"use client";

import { useState } from "react";

export default function DemoHygieneClient() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callEndpoint(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Request failed");
      setMessage(JSON.stringify(json));
    } catch (e: any) {
      setError(e?.message || "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function purgeArchived() {
    const confirmText = window.prompt("Type DELETE to purge archived demo deals.");
    if (confirmText !== "DELETE") return;
    await callEndpoint("/api/admin/demo/hygiene/purge-archived");
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Demo Hygiene</h1>
        <p className="text-sm text-muted-foreground">
          Archive and clean demo deals safely (demo bank only).
        </p>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <button
          className="rounded-xl border px-4 py-3 text-sm font-semibold hover:bg-muted/50 disabled:opacity-50"
          onClick={() => callEndpoint("/api/admin/demo/hygiene/archive-old")}
          disabled={busy}
        >
          Archive demo deals older than 24h
        </button>

        <button
          className="rounded-xl border px-4 py-3 text-sm font-semibold hover:bg-muted/50 disabled:opacity-50"
          onClick={purgeArchived}
          disabled={busy}
        >
          Delete archived demo deals (type DELETE)
        </button>

        <button
          className="rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => callEndpoint("/api/admin/demo/hygiene/reset")}
          disabled={busy}
        >
          Reset demo (archive + reseed)
        </button>
      </div>
    </div>
  );
}
