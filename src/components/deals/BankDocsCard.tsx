"use client";

import React, { useEffect, useState } from "react";

export default function BankDocsCard({ dealId }: { dealId: string }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [bankId, setBankId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBank() {
    const r = await fetch(`/api/deals/${dealId}/bank`);
    const j = await r.json();
    // Bank always exists by FK constraint
    if (j?.ok && j?.bank_id) {
      setBankId(j.bank_id);
    }
  }

  async function refresh() {
    const r = await fetch(`/api/deals/${dealId}/bank-docs/list`);
    const j = await r.json();
    setDocs(j?.documents ?? []);
  }

  async function generate(template_key: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/deals/${dealId}/bank-docs/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_id: bankId, template_key, flatten: false }),
      });
      const j = await r.json();
      if (!j?.ok) {
        setError(j?.error ?? "Generate failed");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadBank();
    refresh();
  }, [dealId]);

  if (!bankId) {
    return (
      <div className="border rounded-lg p-4">
        <div className="font-semibold">Bank PDFs</div>
        <div className="text-sm text-muted-foreground mt-2">No bank linked to this deal. Link one in admin to enable.</div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Bank PDFs</div>
          <div className="text-sm text-muted-foreground">Generate filled bank documents (PFS, Credit App) from deal data.</div>
        </div>
        <button className="border rounded px-3 py-1" onClick={refresh} disabled={busy}>
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {error}
        </div>
      ) : null}

      <div className="flex gap-2 flex-wrap">
        <button className="border rounded px-3 py-1" disabled={busy} onClick={() => generate("PFS")}>
          {busy ? "Working..." : "Generate PFS"}
        </button>
        <button className="border rounded px-3 py-1" disabled={busy} onClick={() => generate("CREDIT_APP")}>
          {busy ? "Working..." : "Generate Credit App"}
        </button>
      </div>

      <div className="space-y-2">
        {docs.map((d) => (
          <div key={d.id} className="border rounded p-3">
            <div className="text-sm font-medium">
              {d.metadata?.template_key ?? "BANK_DOC"} — {new Date(d.created_at).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              missing_canonical={d.metadata?.missing_canonical?.length ?? 0} • missing_pdf_fields={d.metadata?.missing_pdf_fields?.length ?? 0}
            </div>
            <div className="mt-2">
              <a className="underline text-sm" href={d.download_url} target="_blank" rel="noreferrer">
                Download
              </a>
            </div>
          </div>
        ))}
        {docs.length === 0 && <div className="text-sm text-muted-foreground">No generated documents yet.</div>}
      </div>
    </div>
  );
}
