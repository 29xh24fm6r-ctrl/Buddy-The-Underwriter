"use client";

import { useState } from "react";

export default function RegenerateMemoButton({ dealId }: { dealId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleClick() {
    setLoading(true);
    setDone(false);
    try {
      const res = await fetch(`/api/deals/${dealId}/credit-memo/generate`, { method: "POST" });
      if (res.ok) {
        setDone(true);
        // Reload the page to show updated memo data
        window.location.reload();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
    >
      {loading ? (
        <>
          <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          Regenerating…
        </>
      ) : (
        <>
          <span className="material-symbols-outlined text-[14px]">refresh</span>
          Regenerate Memo
        </>
      )}
    </button>
  );
}
