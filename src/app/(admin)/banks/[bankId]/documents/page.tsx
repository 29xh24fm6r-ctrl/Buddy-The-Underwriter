"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CANONICAL_FIELDS } from "@/lib/bankForms/canonicalFields";

type Template = any;
type MapRow = any;

const TRANSFORMS = ["", "money", "date", "upper", "boolean_yesno"] as const;

export default function BankDocumentsAdminPage({ params }: { params: Promise<{ bankId: string }> }) {
  
  const { bankId } = React.use(params);
const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [busy, setBusy] = useState(false);

  // upload states
  const [templateKey, setTemplateKey] = useState("PFS");
  const [templateVersion, setTemplateVersion] = useState("v1");
  const [templateName, setTemplateName] = useState("Personal Financial Statement");

  const [policyVersion, setPolicyVersion] = useState("v1");
  const [policyName, setPolicyName] = useState("Credit Policy");

  async function loadTemplates() {
    const r = await fetch(`/api/admin/banks/${bankId}/templates`);
    const j = await r.json();
    setTemplates(j?.templates ?? []);
    if (!selectedTemplate && (j?.templates?.length ?? 0) > 0) {
      setSelectedTemplate(j.templates[0]);
    }
  }

  async function loadMaps(templateId: string) {
    const r = await fetch(`/api/admin/templates/${templateId}/maps`);
    const j = await r.json();
    setMaps(j?.maps ?? []);
  }

  useEffect(() => {
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  useEffect(() => {
    if (selectedTemplate?.id) loadMaps(selectedTemplate.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id]);

  const pdfFields = useMemo(() => {
    const fields = selectedTemplate?.metadata?.pdf_form_fields ?? [];
    return fields.map((f: any) => f.name);
  }, [selectedTemplate]);

  async function uploadTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fileInput = formEl.querySelector<HTMLInputElement>('input[name="file"]');
    if (!fileInput?.files?.[0]) return alert("Choose a PDF file.");

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("template_key", templateKey);
      fd.append("version", templateVersion);
      fd.append("name", templateName);
      fd.append("file", fileInput.files[0]);

      const r = await fetch(`/api/admin/banks/${bankId}/templates/upload`, { method: "POST", body: fd });
      const j = await r.json();
      if (!j?.ok) return alert(j?.error ?? "Upload failed");

      await loadTemplates();
      alert(`Uploaded template. Parsed fields: ${j.parsed_fields_count ?? 0}`);
      fileInput.value = "";
    } finally {
      setBusy(false);
    }
  }

  async function uploadPolicy(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fileInput = formEl.querySelector<HTMLInputElement>('input[name="file"]');
    if (!fileInput?.files?.[0]) return alert("Choose a policy file.");

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("version", policyVersion);
      fd.append("name", policyName);
      fd.append("file", fileInput.files[0]);

      const r = await fetch(`/api/admin/banks/${bankId}/policies/upload`, { method: "POST", body: fd });
      const j = await r.json();
      if (!j?.ok) return alert(j?.error ?? "Upload failed");

      alert("Policy uploaded and set active.");
      fileInput.value = "";
    } finally {
      setBusy(false);
    }
  }

  async function addMapRow(row: Partial<MapRow>) {
    if (!selectedTemplate?.id) return;

    setBusy(true);
    try {
      const r = await fetch(`/api/admin/templates/${selectedTemplate.id}/maps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
      const j = await r.json();
      if (!j?.ok) return alert(j?.error ?? "Failed to save map");
      await loadMaps(selectedTemplate.id);
    } finally {
      setBusy(false);
    }
  }

  async function deleteMapRow(id: string) {
    if (!selectedTemplate?.id) return;

    setBusy(true);
    try {
      const r = await fetch(`/api/admin/templates/${selectedTemplate.id}/maps?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!j?.ok) return alert(j?.error ?? "Failed to delete map");
      await loadMaps(selectedTemplate.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold">Bank Documents</div>
          <div className="text-sm text-muted-foreground">
            Upload PDF templates (PFS/Credit App) + map canonical fields → PDF fields. Upload credit policy for Buddy context.
          </div>
        </div>
        <button className="border rounded px-3 py-1" onClick={loadTemplates} disabled={busy}>
          Refresh
        </button>
      </div>

      {/* Upload panels */}
      <div className="grid md:grid-cols-2 gap-4">
        <form onSubmit={uploadTemplate} className="border rounded-lg p-4 space-y-3">
          <div className="font-medium">Upload Template</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="border rounded px-2 py-1" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} placeholder="PFS" />
            <input className="border rounded px-2 py-1" value={templateVersion} onChange={(e) => setTemplateVersion(e.target.value)} placeholder="v1" />
            <input className="border rounded px-2 py-1 col-span-2" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" />
          </div>
          <input name="file" type="file" accept="application/pdf" />
          <button className="border rounded px-3 py-1" disabled={busy} type="submit">
            {busy ? "Uploading..." : "Upload Template PDF"}
          </button>
        </form>

        <form onSubmit={uploadPolicy} className="border rounded-lg p-4 space-y-3">
          <div className="font-medium">Upload Credit Policy</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="border rounded px-2 py-1" value={policyVersion} onChange={(e) => setPolicyVersion(e.target.value)} placeholder="v1" />
            <input className="border rounded px-2 py-1" value={policyName} onChange={(e) => setPolicyName(e.target.value)} placeholder="Credit Policy" />
          </div>
          <input name="file" type="file" />
          <button className="border rounded px-3 py-1" disabled={busy} type="submit">
            {busy ? "Uploading..." : "Upload Policy"}
          </button>
        </form>
      </div>

      {/* Template selector + mapping */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 space-y-2">
          <div className="font-medium">Templates</div>
          <div className="space-y-2">
            {templates.map((t) => (
              <button
                key={t.id}
                className={`w-full text-left border rounded px-3 py-2 ${selectedTemplate?.id === t.id ? "bg-muted/40" : ""}`}
                onClick={() => setSelectedTemplate(t)}
              >
                <div className="text-sm font-medium">{t.template_key} — {t.version}</div>
                <div className="text-xs text-muted-foreground">{t.name}</div>
              </button>
            ))}
            {templates.length === 0 && <div className="text-sm text-muted-foreground">No templates yet.</div>}
          </div>
        </div>

        <div className="border rounded-lg p-4 space-y-3 md:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Field Mapping</div>
              <div className="text-xs text-muted-foreground">
                Canonical fields are Buddy&apos;s internal schema. Map them to your PDF&apos;s AcroForm field names.
              </div>
            </div>
          </div>

          {!selectedTemplate && <div className="text-sm text-muted-foreground">Select a template.</div>}

          {selectedTemplate && (
            <MappingEditor
              pdfFields={pdfFields}
              maps={maps}
              onAdd={addMapRow}
              onDelete={deleteMapRow}
              busy={busy}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MappingEditor(props: {
  pdfFields: string[];
  maps: any[];
  onAdd: (row: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  busy: boolean;
}) {
  const [canonical_field, setCanonicalField] = useState<string>(CANONICAL_FIELDS[0]);
  const [pdf_field, setPdfField] = useState(props.pdfFields?.[0] ?? "");
  const [transform, setTransform] = useState<string>("");
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (!pdf_field && props.pdfFields?.length) setPdfField(props.pdfFields[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pdfFields?.length]);

  return (
    <div className="space-y-3">
      <div className="border rounded p-3 space-y-2">
        <div className="text-sm font-medium">Add mapping</div>
        <div className="grid md:grid-cols-4 gap-2">
          <select className="border rounded px-2 py-1" value={canonical_field} onChange={(e) => setCanonicalField(e.target.value)}>
            {CANONICAL_FIELDS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <select className="border rounded px-2 py-1" value={pdf_field} onChange={(e) => setPdfField(e.target.value)}>
            {props.pdfFields.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <select className="border rounded px-2 py-1" value={transform} onChange={(e) => setTransform(e.target.value)}>
            {TRANSFORMS.map((t) => (
              <option key={t} value={t}>{t || "(none)"}</option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required
          </label>
        </div>

        <button
          className="border rounded px-3 py-1"
          disabled={props.busy || !canonical_field || !pdf_field}
          onClick={() => props.onAdd({ canonical_field, pdf_field, transform: transform || null, required })}
          type="button"
        >
          Add
        </button>
      </div>

      <div className="border rounded p-3">
        <div className="text-sm font-medium mb-2">Current mappings</div>
        <div className="space-y-2">
          {props.maps.map((m) => (
            <div key={m.id} className="border rounded p-2 flex items-center justify-between">
              <div className="text-xs">
                <div><b>{m.canonical_field}</b> → {m.pdf_field}</div>
                <div className="text-muted-foreground">transform={m.transform ?? "(none)"} required={String(m.required)}</div>
              </div>
              <button className="border rounded px-2 py-1 text-xs" disabled={props.busy} onClick={() => props.onDelete(m.id)}>
                Remove
              </button>
            </div>
          ))}
          {props.maps.length === 0 && <div className="text-sm text-muted-foreground">No mappings yet.</div>}
        </div>
      </div>
    </div>
  );
}
