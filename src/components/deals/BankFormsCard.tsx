"use client";

import React, { useState } from "react";

type BankFormsCardProps = {
  dealId: string;
};

export default function BankFormsCard({ dealId }: BankFormsCardProps) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [fillRun, setFillRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  async function loadTemplates() {
    setBusy(true);
    try {
      const templatesRes = await fetch(`/api/deals/${dealId}/forms/templates`, {
        cache: "no-store",
      });
      const templatesData = await templatesRes.json();

      if (templatesData.ok) {
        setTemplates(templatesData.templates ?? []);
      }
    } finally {
      setBusy(false);
    }
  }

  async function prepareFill() {
    if (!selectedTemplate) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/forms/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: selectedTemplate }),
      });

      const data = await res.json();

      if (!data.ok) {
        alert(data.error ?? "Failed to prepare form");
        return;
      }

      setFillRun(data);
    } finally {
      setBusy(false);
    }
  }

  async function generatePdf() {
    if (!fillRun) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/forms/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fill_run_id: fillRun.fill_run_id, flatten: true }),
      });

      const data = await res.json();

      if (!data.ok) {
        alert(data.error ?? "Failed to generate PDF");
        return;
      }

      setDownloadUrl(data.download_url);
      alert("PDF generated successfully!");
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    loadTemplates();
  }, [dealId]);

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-white">
      <div>
        <div className="font-semibold">Bank Forms</div>
        <div className="text-xs text-gray-600">Auto-fill templates with deal data</div>
      </div>

      {templates.length === 0 && !busy && (
        <div className="text-sm text-gray-500 py-4 text-center border rounded bg-gray-50">
          No templates available. Assign bank to deal first.
        </div>
      )}

      {templates.length > 0 && (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">Select Template</label>
            <select
              className="border rounded px-2 py-1 w-full text-sm"
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
            >
              <option value="">-- Choose template --</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.document_type}
                </option>
              ))}
            </select>
          </div>

          <button
            className="border rounded px-3 py-1 bg-black text-white text-sm w-full hover:opacity-90 disabled:opacity-40"
            onClick={prepareFill}
            disabled={!selectedTemplate || busy}
          >
            {busy ? "Preparing..." : "Prepare Form"}
          </button>

          {fillRun && (
            <div className="border rounded p-3 bg-gray-50 text-xs space-y-2">
              <div className="font-medium">Fill Status: {fillRun.status}</div>
              <div>Fields filled: {Object.keys(fillRun.field_values).length}</div>
              {fillRun.missing_required_fields?.length > 0 && (
                <div className="text-amber-700">
                  Missing required: {fillRun.missing_required_fields.join(", ")}
                </div>
              )}
              <button
                className="border rounded px-3 py-1 bg-green-600 text-white text-sm w-full hover:opacity-90 disabled:opacity-40"
                onClick={generatePdf}
                disabled={busy}
              >
                {busy ? "Generating..." : "Generate PDF"}
              </button>
            </div>
          )}

          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block border rounded px-3 py-2 bg-blue-600 text-white text-sm text-center hover:opacity-90"
            >
              Download Filled PDF
            </a>
          )}
        </div>
      )}
    </div>
  );
}
