"use client";

import React, { useEffect, useMemo, useState } from "react";

type StatRow = {
  canonical_field: string;
  mapping_count: number;
  template_count: number;
};

type LoadResponse =
  | {
      ok: true;
      canonical_fields: string[];
      stats: StatRow[];
      unknown_canonical_fields: string[];
    }
  | { ok: false; error: string };

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CanonicalFieldsAdminClient() {
  const [stats, setStats] = useState<StatRow[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/canonical-fields/stats", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as LoadResponse | null;
      if (!j?.ok) throw new Error(j?.error ?? `Failed to load (${r.status})`);
      setStats(j.stats ?? []);
      setUnknown(j.unknown_canonical_fields ?? []);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStats([]);
      setUnknown([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stats
      .filter((s) => {
        if (!q) return true;
        return s.canonical_field.toLowerCase().includes(q);
      })
      .sort((a, b) => a.canonical_field.localeCompare(b.canonical_field));
  }, [stats, query]);

  function exportCsv() {
    const header = ["canonical_field", "template_count", "mapping_count"].join(",");
    const lines = visible.map((s) =>
      [JSON.stringify(s.canonical_field), String(s.template_count), String(s.mapping_count)].join(","),
    );
    downloadText(
      `buddy-canonical-fields-${new Date().toISOString().slice(0, 10)}.csv`,
      [header, ...lines].join("\n"),
      "text/csv",
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-semibold">Canonical Fields</div>
          <div className="text-sm text-muted-foreground">
            Source of truth is code (<span className="font-mono">CANONICAL_FIELDS</span>). This view shows mapping coverage
            across all templates.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="border rounded px-3 py-1" onClick={load} disabled={busy}>
            {busy ? "Loading…" : "Refresh"}
          </button>
          <button className="border rounded px-3 py-1" onClick={exportCsv} disabled={busy || visible.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-500/40 bg-red-500/10 text-red-200 rounded p-3 text-sm">{error}</div>
      )}

      {unknown.length > 0 && (
        <div className="border border-amber-500/40 bg-amber-500/10 text-amber-200 rounded p-3 text-sm">
          <div className="font-medium">Unknown canonical fields in DB mappings</div>
          <div className="text-xs text-muted-foreground mt-1">
            These appear in <span className="font-mono">bank_template_field_maps.canonical_field</span> but are not present in
            <span className="font-mono"> CANONICAL_FIELDS</span>.
          </div>
          <div className="mt-2 font-mono text-xs whitespace-pre-wrap break-words">{unknown.join("\n")}</div>
        </div>
      )}

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Search</label>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="canonical field name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="border rounded overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium bg-muted/40">
          <div className="col-span-8">Canonical field</div>
          <div className="col-span-2">Templates</div>
          <div className="col-span-2">Mappings</div>
        </div>
        <div className="divide-y">
          {visible.map((s) => (
            <div key={s.canonical_field} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm">
              <div className="col-span-8 font-mono text-xs truncate">{s.canonical_field}</div>
              <div className="col-span-2 text-sm">{s.template_count}</div>
              <div className="col-span-2 text-sm">{s.mapping_count}</div>
            </div>
          ))}

          {!busy && visible.length === 0 && (
            <div className="px-3 py-6 text-sm text-muted-foreground">No canonical fields match your query.</div>
          )}
        </div>
      </div>
    </div>
  );
}
