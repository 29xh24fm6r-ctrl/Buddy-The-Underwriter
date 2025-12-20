"use client";

import React, { useEffect, useState } from "react";

type Row = {
  id: string;
  uploaded_at: string;
  uploader_type: "internal" | "borrower" | "system";
  uploader_display_name: string | null;
  uploader_email: string | null;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  checklist_key: string | null;
  storage_path: string;
  uploaded_via_link_id: string | null;
};

function prettyBytes(n?: number | null) {
  if (!n || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let x = n;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function UploadAuditCard({ dealId }: { dealId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/uploads/audit`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Failed to load audit trail.");
        return;
      }
      setRows(json.rows || []);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-neutral-50">Upload Audit Trail</div>
          <div className="mt-1 text-sm text-neutral-400">Who uploaded what, when, and (optionally) which checklist key it satisfied.</div>
        </div>
        <button
          onClick={refresh}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
          disabled={busy}
        >
          Refresh
        </button>
      </div>

      {msg ? (
        <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm text-neutral-200">
          {msg}
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 text-sm text-neutral-400">
            No uploads yet.
          </div>
        ) : null}

        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-neutral-800 bg-neutral-950/20 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="text-sm text-neutral-100 truncate">{r.original_filename}</div>
                <div className="mt-1 text-xs text-neutral-400">
                  {new Date(r.uploaded_at).toLocaleString()} • {r.uploader_type.toUpperCase()}
                  {r.uploader_display_name ? ` • ${r.uploader_display_name}` : ""}
                  {r.uploader_email ? ` • ${r.uploader_email}` : ""}
                  {r.size_bytes ? ` • ${prettyBytes(r.size_bytes)}` : ""}
                </div>
                {r.checklist_key ? (
                  <div className="mt-1 text-xs text-neutral-300">
                    Checklist key: <span className="font-mono">{r.checklist_key}</span>
                  </div>
                ) : null}
              </div>

              <div className="text-[11px] text-neutral-500 font-mono break-all md:max-w-[45%]">
                {r.storage_path}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
