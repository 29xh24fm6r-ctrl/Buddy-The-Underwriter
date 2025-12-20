"use client";

import React, { useEffect, useState } from "react";

type PackageItem = {
  id: string;
  template_code: string;
  title: string;
  sort_order: number;
  required: boolean;
  status: "prepared" | "generated" | "failed";
  fill_run_id: string | null;
  output_storage_path: string | null;
  output_file_name: string | null;
  error: string | null;
  updated_at: string;
};

export default function SbaPackageBuilderCard({ dealId }: { dealId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [packageRunId, setPackageRunId] = useState<string | null>(null);
  const [items, setItems] = useState<PackageItem[]>([]);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/sba/package/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageTemplateCode: "SBA_7A_BASE",
          product: "7a",
          answers: {},
          borrowerData: null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "prepare_failed");

      setPackageRunId(json.packageRunId);
    } catch (e: any) {
      setError(e?.message || "prepare_failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadItems(runId: string) {
    const res = await fetch(`/api/deals/${dealId}/sba/package/${runId}/items`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "items_load_failed");
    setItems(json.items ?? []);
  }

  async function generateAll() {
    if (!packageRunId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/sba/package/${packageRunId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "generate_failed");

      await loadItems(packageRunId);
    } catch (e: any) {
      setError(e?.message || "generate_failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateOne(itemId: string) {
    if (!packageRunId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/sba/package/${packageRunId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlyItemId: itemId }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "generate_one_failed");

      await loadItems(packageRunId);
    } catch (e: any) {
      setError(e?.message || "generate_one_failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!packageRunId) return;
    loadItems(packageRunId).catch((e) => setError(e?.message || "items_load_failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageRunId]);

  const generatedCount = items.filter((i) => i.status === "generated").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">SBA Package Builder</h3>
          <p className="mt-1 text-xs text-neutral-600">
            {!packageRunId ? "Prepare a complete SBA package run" : `${generatedCount} generated • ${failedCount} failed • ${items.length} total`}
          </p>
        </div>

        {!packageRunId ? (
          <button
            type="button"
            onClick={prepare}
            disabled={busy}
            className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Prepare Package"}
          </button>
        ) : (
          <button
            type="button"
            onClick={generateAll}
            disabled={busy}
            className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate All PDFs"}
          </button>
        )}
      </header>

      {error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      {packageRunId ? (
        <div className="mt-4 space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between rounded border p-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{it.title}</div>
                <div className="mt-0.5 text-[11px] text-neutral-600">
                  {it.template_code} • {it.required ? "Required" : "Optional"} • {it.status}
                </div>
                {it.error ? <div className="mt-1 text-[11px] text-red-700">{it.error}</div> : null}
              </div>

              <button
                type="button"
                onClick={() => generateOne(it.id)}
                disabled={busy}
                className="rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-neutral-50 disabled:opacity-50"
              >
                Generate
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
