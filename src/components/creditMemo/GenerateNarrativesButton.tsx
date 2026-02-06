"use client";

import { useState } from "react";

export default function GenerateNarrativesButton({ dealId }: { dealId: string }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  const handleClick = async () => {
    setLoading(true);
    setStatus("idle");
    try {
      const res = await fetch(`/api/deals/${dealId}/credit-memo/canonical/narratives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setStatus("success");
        // Reload the page to show narratives in the server-rendered memo
        window.location.reload();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
        loading
          ? "border-gray-200 text-gray-400 cursor-wait"
          : status === "success"
            ? "border-emerald-300 text-emerald-700 bg-emerald-50"
            : status === "error"
              ? "border-rose-300 text-rose-700 bg-rose-50"
              : "border-gray-300 text-gray-800 hover:bg-gray-50"
      }`}
    >
      {loading ? (
        <>
          <span className="animate-spin">⟳</span>
          Generating...
        </>
      ) : status === "success" ? (
        "Narratives Generated"
      ) : status === "error" ? (
        "Generation Failed — Retry?"
      ) : (
        <>
          <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
          Generate Narratives
        </>
      )}
    </button>
  );
}
