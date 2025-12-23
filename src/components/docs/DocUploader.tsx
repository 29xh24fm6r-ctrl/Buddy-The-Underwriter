"use client";

import { useState } from "react";

const DOC_TYPES = [
  "FINANCIALS",
  "BANK_STATEMENTS",
  "TAX_RETURNS",
  "PFS",
  "RENT_ROLL",
  "AR_AGING",
  "APP",
  "TERM_SHEET",
  "COMMITMENT_LETTER",
  "CREDIT_POLICY",
  "OTHER",
];

export default function DocUploader(props: { dealId: string }) {
  const [docType, setDocType] = useState("FINANCIALS");
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upload() {
    if (!files || files.length === 0) return;
    setLoading(true);
    setErr(null);
    setResp(null);

    try {
      const fd = new FormData();
      fd.append("dealId", props.dealId);
      fd.append("docType", docType);

      // append all files
      Array.from(files).forEach((f) => fd.append("files", f, f.name));

      const r = await fetch("/api/docs/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Upload failed");
      setResp(j);
    } catch (e: any) {
      setErr(e?.message ?? "Upload error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Upload Documents</div>
          <div className="text-xs text-gray-600">
            Bulk upload supported. Files stored to deal vault and registered for extraction.
          </div>
        </div>
        <div className="text-xs text-gray-500">{loading ? "Uploading…" : "Ready"}</div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <div className="text-xs font-semibold text-gray-700">Document Type</div>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <div className="text-xs font-semibold text-gray-700">Files</div>
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(e.target.files)}
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
          />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={upload}
          disabled={loading || !files || files.length === 0}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Upload
        </button>
      </div>

      {err && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {resp && (
        <div className="mt-3 rounded-xl border bg-gray-50 p-3 text-xs">
          <div className="font-semibold">Upload Result</div>
          <pre className="mt-2 overflow-auto">{JSON.stringify(resp, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
