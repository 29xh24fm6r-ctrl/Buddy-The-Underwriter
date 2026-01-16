"use client";

import { useState } from "react";

export default function ExportCanonicalMemoPdfButton({
  dealId,
  className,
  label = "Export PDF",
}: {
  dealId: string;
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!dealId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/credit-memo/canonical/pdf`, {
        method: "POST",
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `pdf_export_failed:${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={
          className ??
          "inline-flex items-center rounded-md bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-gray-900 disabled:opacity-60"
        }
      >
        {busy ? "Generating…" : label}
      </button>
      {error ? <div className="text-[10px] text-rose-200 max-w-[320px] truncate">{error}</div> : null}
    </div>
  );
}
