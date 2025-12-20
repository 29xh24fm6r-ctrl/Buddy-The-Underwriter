"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ApplyTemplatesButton({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/templates/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ onlyActive: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setToast(`Applied templates. Created ${json.createdCount}, skipped ${json.skippedCount}.`);

      // ✅ Make the new requests show up immediately
      router.refresh();
    } catch (e: any) {
      setToast(e?.message || "Apply failed");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 4500);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {toast ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {toast}
        </div>
      ) : null}

      <button
        type="button"
        onClick={apply}
        disabled={busy}
        className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Applying…" : "Apply Templates to Deal"}
      </button>
    </div>
  );
}
