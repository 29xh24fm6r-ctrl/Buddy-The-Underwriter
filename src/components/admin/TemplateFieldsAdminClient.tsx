"use client";

import React, { useEffect, useMemo, useState } from "react";

type TemplateRow = {
  id: string;
  bank_id: string;
  template_key: string | null;
  version: number | null;
  name: string | null;
  created_at: string | null;
};

type FieldRow = {
  template_id: string;
  template_key: string | null;
  template_version: number | null;
  template_name: string | null;
  field_name: string;
  field_type: string | null;
  is_required: boolean;
  mapped: boolean;
  meta: any;
  created_at: string | null;
};

type LoadResponse =
  | { ok: true; templates: TemplateRow[]; fields: FieldRow[] }
  | { ok: false; error: string };

type SetRequiredResponse =
  | { ok: true; field: any }
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

function safeString(v: unknown) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export default function TemplateFieldsAdminClient() {
  const [bankId, setBankId] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(next?: { bankId?: string; templateId?: string | "all" }) {
    const nextBankId = (next?.bankId ?? bankId).trim();
    const nextTemplateId = next?.templateId ?? selectedTemplateId;

    if (!nextBankId) {
      setTemplates([]);
      setFields([]);
      setError(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const url = new URL(`/api/admin/banks/${encodeURIComponent(nextBankId)}/template-fields`, window.location.origin);
      if (nextTemplateId !== "all") url.searchParams.set("templateId", nextTemplateId);

      const r = await fetch(url.toString(), { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as LoadResponse | null;
      if (!j?.ok) throw new Error(j?.error ?? `Failed to load fields (${r.status})`);
      setTemplates(j.templates ?? []);
      setFields(j.fields ?? []);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setTemplates([]);
      setFields([]);
    } finally {
      setBusy(false);
    }
  }

  async function setRequired(templateId: string, fieldName: string, required: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/templates/${encodeURIComponent(templateId)}/fields/set-required`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field_name: fieldName, required }),
      });
      const j = (await r.json().catch(() => null)) as SetRequiredResponse | null;
      if (!j?.ok) throw new Error(j?.error ?? `Failed to update required (${r.status})`);
      await load({ templateId: selectedTemplateId });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const u = new URL(window.location.href);
    const initial = (u.searchParams.get("bankId") ?? "").trim();
    if (initial) {
      setBankId(initial);
      void load({ bankId: initial });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const templatesById = useMemo(() => {
    const m = new Map<string, TemplateRow>();
    for (const t of templates) m.set(String(t.id), t);
    return m;
  }, [templates]);

  const visibleFields = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fields
      .filter((f) => {
        if (!q) return true;
        const hay = [f.field_name, f.field_type, f.template_key, f.template_name]
          .filter(Boolean)
          .map((x) => safeString(x).toLowerCase())
          .join(" ");
        return hay.includes(q);
      })
      .sort((a, b) => {
        const at = (a.template_name ?? a.template_key ?? a.template_id).toLowerCase();
        const bt = (b.template_name ?? b.template_key ?? b.template_id).toLowerCase();
        if (at !== bt) return at.localeCompare(bt);
        return a.field_name.localeCompare(b.field_name);
      });
  }, [fields, query]);

  function exportCsv() {
    const header = [
      "template_id",
      "template_key",
      "template_version",
      "template_name",
      "field_name",
      "field_type",
      "is_required",
      "mapped",
    ].join(",");

    const lines = visibleFields.map((f) =>
      [
        JSON.stringify(f.template_id),
        JSON.stringify(f.template_key ?? ""),
        JSON.stringify(f.template_version ?? ""),
        JSON.stringify(f.template_name ?? ""),
        JSON.stringify(f.field_name),
        JSON.stringify(f.field_type ?? ""),
        f.is_required ? "1" : "0",
        f.mapped ? "1" : "0",
      ].join(","),
    );

    const csv = [header, ...lines].join("\n");
    downloadText(
      `buddy-template-fields-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      "text/csv",
    );
  }

  const selectedTemplateLabel =
    selectedTemplateId === "all"
      ? "All templates"
      : (templatesById.get(selectedTemplateId)?.name ??
          templatesById.get(selectedTemplateId)?.template_key ??
          selectedTemplateId);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-semibold">Template Field Registry</div>
          <div className="text-sm text-muted-foreground">
            Parsed AcroForm fields (from <span className="font-mono">bank_document_template_fields</span>) scoped by bank.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="border rounded px-3 py-1" onClick={() => load()} disabled={busy || !bankId.trim()}>
            {busy ? "Loading…" : "Refresh"}
          </button>
          <button className="border rounded px-3 py-1" onClick={exportCsv} disabled={busy || visibleFields.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-500/40 bg-red-500/10 text-red-200 rounded p-3 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Bank ID</label>
            <div className="flex gap-2">
              <input
                className="w-full border rounded px-3 py-2 font-mono text-xs"
                placeholder="bank uuid"
                value={bankId}
                onChange={(e) => setBankId(e.target.value)}
              />
              <button
                className="border rounded px-3 py-2"
                onClick={() => load({ bankId, templateId: "all" })}
                disabled={busy || !bankId.trim()}
              >
                Load
              </button>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Tip: add <span className="font-mono">?bankId=...</span> to the URL to deep-link.
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Template</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={selectedTemplateId}
              onChange={(e) => {
                const v = e.target.value as any;
                setSelectedTemplateId(v);
                void load({ templateId: v });
              }}
              disabled={busy || templates.length === 0}
            >
              <option value="all">All templates</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {(t.name ?? t.template_key ?? t.id).slice(0, 80)}
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs text-muted-foreground border rounded p-3">
            <div>Templates: {templates.length}</div>
            <div>Fields (visible): {visibleFields.length}</div>
            <div>
              Selected: <span className="font-medium text-foreground">{selectedTemplateLabel}</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-9 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Search fields</label>
            <input
              className="w-full border rounded px-3 py-2"
              placeholder="field name, type, template"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="border rounded overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium bg-muted/40">
              <div className="col-span-4">Template</div>
              <div className="col-span-4">Field</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-1">Req</div>
              <div className="col-span-1">Mapped</div>
            </div>

            <div className="divide-y">
              {visibleFields.map((f) => {
                const t = templatesById.get(f.template_id);
                const templateLabel = t?.name ?? t?.template_key ?? f.template_id;
                return (
                  <div key={`${f.template_id}:${f.field_name}`} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm">
                    <div className="col-span-4 min-w-0">
                      <div className="truncate">{templateLabel}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{f.template_id}</div>
                    </div>

                    <div className="col-span-4 min-w-0">
                      <div className="font-mono text-xs truncate">{f.field_name}</div>
                    </div>

                    <div className="col-span-2 text-xs font-mono text-muted-foreground truncate">
                      {f.field_type ?? "—"}
                    </div>

                    <div className="col-span-1">
                      <input
                        type="checkbox"
                        checked={f.is_required}
                        onChange={(e) => void setRequired(f.template_id, f.field_name, e.target.checked)}
                        disabled={busy}
                        title="Toggle is_required"
                      />
                    </div>

                    <div className="col-span-1 text-xs">
                      {f.mapped ? "Yes" : "No"}
                    </div>
                  </div>
                );
              })}

              {!busy && bankId.trim() && visibleFields.length === 0 && (
                <div className="px-3 py-6 text-sm text-muted-foreground">No fields match your filters.</div>
              )}

              {!busy && !bankId.trim() && (
                <div className="px-3 py-6 text-sm text-muted-foreground">Enter a bank id to load parsed fields.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
