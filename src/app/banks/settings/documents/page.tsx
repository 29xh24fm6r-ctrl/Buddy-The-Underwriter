// src/app/banks/settings/documents/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type BankAsset = {
  id: string;
  bank_id: string;
  kind: "policy" | "form_template" | "sop" | "checklist" | "rate_sheet" | "other";
  title: string;
  description: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  version: number;
  active: boolean;
  created_at: string;
};

const KINDS: BankAsset["kind"][] = ["policy", "form_template", "sop", "checklist", "rate_sheet", "other"];

export const dynamic = "force-dynamic";

export default function BankDocumentsPage() {
  const [items, setItems] = useState<BankAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [kind, setKind] = useState<BankAsset["kind"]>("policy");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const canUpload = useMemo(() => !!file && title.trim().length > 0 && !busy, [file, title, busy]);

  async function refresh() {
    setErr(null);
    const res = await fetch("/api/banks/assets/list", { method: "GET" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setErr(json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ""}` : `http_${res.status}`);
      return;
    }
    setItems(json.items || []);
  }

  useEffect(() => { refresh(); }, []);

  async function upload() {
    if (!file) return;

    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("title", title.trim());
      fd.append("description", description.trim() || "");
      fd.append("file", file);

      const res = await fetch("/api/banks/assets/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setErr(json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ""}` : `http_${res.status}`);
        return;
      }

      setTitle("");
      setDescription("");
      setFile(null);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "upload_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Bank Knowledge Vault</h1>
        <p className="text-muted-foreground mt-2">
          Upload your bank's credit policy, SOPs, and fillable form templates. Buddy will use these per-bank.
        </p>
      </div>

      <div className="rounded-2xl border p-5 space-y-4">
        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
            {err}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-semibold">Kind</label>
            <select className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as any)}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold">Title</label>
            <input className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Credit Policy 2025" />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-semibold">Description (optional)</label>
            <input className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this document used for?" />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-semibold">File</label>
            <input className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>

        <button
          disabled={!canUpload}
          onClick={upload}
          className="rounded-xl border px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>

      <div className="rounded-2xl border p-5">
        <div className="text-sm font-semibold">Current Vault Items</div>
        <div className="mt-3 space-y-2">
          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground">No documents uploaded yet.</div>
          ) : (
            items.map((it) => (
              <div key={it.id} className="rounded-xl border p-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">{it.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {it.kind} · v{it.version} · {it.active ? "active" : "inactive"} · {new Date(it.created_at).toLocaleString()}
                  </div>
                  {it.description ? <div className="text-sm text-muted-foreground mt-2">{it.description}</div> : null}
                  <div className="text-xs text-muted-foreground mt-2 break-words">{it.storage_path}</div>
                </div>

                <form action="/api/banks/assets/disable" method="post">
                  <input type="hidden" name="id" value={it.id} />
                  <button className="rounded-xl border px-3 py-2 text-xs font-semibold">
                    Disable
                  </button>
                </form>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
