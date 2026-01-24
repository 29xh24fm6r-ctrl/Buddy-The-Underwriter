"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Template = any;

export default function TemplatesVaultClient() {
  const sp = useSearchParams();
  const bankIdFromUrl = useMemo(() => (sp ? sp.get("bankId") ?? "" : ""), [sp]);

  const [bankId, setBankId] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [templateKey, setTemplateKey] = useState("PFS");
  const [templateVersion, setTemplateVersion] = useState("v1");
  const [templateName, setTemplateName] = useState("Personal Financial Statement");

  const hasBank = useMemo(() => bankId.trim().length > 0, [bankId]);

  useEffect(() => {
    if (bankIdFromUrl && bankIdFromUrl !== bankId) {
      setBankId(bankIdFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankIdFromUrl]);

  useEffect(() => {
    if (bankIdFromUrl) {
      loadTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankIdFromUrl]);

  async function loadTemplates() {
    if (!hasBank) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/banks/${encodeURIComponent(bankId)}/templates`, {
        cache: "no-store",
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setError(j?.error ?? `load_failed_http_${r.status}`);
        setTemplates([]);
        return;
      }
      setTemplates(j.templates ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function uploadTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!hasBank) {
      setError("missing_bank_id");
      return;
    }

    const formEl = e.currentTarget;
    const fileInput = formEl.querySelector<HTMLInputElement>('input[name="file"]');
    if (!fileInput?.files?.[0]) {
      setError("missing_file");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("template_key", templateKey);
      fd.append("version", templateVersion);
      fd.append("name", templateName);
      fd.append("file", fileInput.files[0]);

      const r = await fetch(`/api/admin/banks/${encodeURIComponent(bankId)}/templates/upload`, {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setError(j?.error ?? `upload_failed_http_${r.status}`);
        return;
      }

      await loadTemplates();
      fileInput.value = "";
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-2xl font-semibold">Document Template Vault</div>
        <div className="text-sm text-muted-foreground">
          Enter a bank id, then list/upload PDF templates (AcroForm fields are auto-parsed).
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <div className="font-medium">Bank</div>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            className="border rounded px-2 py-1 w-full"
            placeholder="bank_id (UUID)"
            value={bankId}
            onChange={(e) => setBankId(e.target.value)}
          />
          <button className="border rounded px-3 py-1" onClick={loadTemplates} disabled={busy || !hasBank}>
            {busy ? "Loading..." : "Load"}
          </button>
          {hasBank ? (
            <a
              className="border rounded px-3 py-1 inline-flex items-center justify-center"
              href={`/banks/${encodeURIComponent(bankId)}/documents`}
            >
              Open Mapping Editor
            </a>
          ) : null}
        </div>
      </div>

      <form onSubmit={uploadTemplate} className="border rounded-lg p-4 space-y-3">
        <div className="font-medium">Upload Template</div>
        <div className="grid md:grid-cols-3 gap-2">
          <input className="border rounded px-2 py-1" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} placeholder="PFS" />
          <input className="border rounded px-2 py-1" value={templateVersion} onChange={(e) => setTemplateVersion(e.target.value)} placeholder="v1" />
          <input className="border rounded px-2 py-1" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" />
        </div>
        <input name="file" type="file" accept="application/pdf" />
        <button className="border rounded px-3 py-1" disabled={busy || !hasBank} type="submit">
          {busy ? "Uploading..." : "Upload"}
        </button>
      </form>

      {error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{error}</div>
      ) : null}

      <div className="border rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-medium">Templates</div>
          <button className="border rounded px-3 py-1" onClick={loadTemplates} disabled={busy || !hasBank}>
            Refresh
          </button>
        </div>
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="border rounded p-3">
              <div className="text-sm font-medium">
                {t.template_key} — {t.version} {t.is_active ? "(active)" : ""}
              </div>
              <div className="text-xs text-muted-foreground">{t.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                fields={(t.metadata?.pdf_form_fields?.length ?? 0).toString()}
              </div>
            </div>
          ))}
          {templates.length === 0 ? (
            <div className="text-sm text-muted-foreground">No templates loaded.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
