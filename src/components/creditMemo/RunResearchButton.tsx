"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ButtonStatus = "idle" | "started" | "duplicate" | "error";

export default function RunResearchButton({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<ButtonStatus>("idle");

  const handleClick = async () => {
    setLoading(true);
    setStatus("idle");
    try {
      const res = await fetch(`/api/deals/${dealId}/research/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      // 202: the mission row exists (queued) and the durable workflow owns
      // it from here. A duplicate means an identical mission already exists.
      const payload = (await res.json().catch(() => ({}))) as { duplicate?: boolean; already_running?: boolean };
      setStatus(payload.duplicate || payload.already_running ? "duplicate" : "started");
      router.refresh();
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
          : status === "started" || status === "duplicate"
            ? "border-emerald-300 text-emerald-700 bg-emerald-50"
            : status === "error"
              ? "border-rose-300 text-rose-700 bg-rose-50"
              : "border-gray-300 text-gray-800 hover:bg-gray-50"
      }`}
    >
      {loading ? (
        <>
          <span className="animate-spin">⟳</span>
          Starting Research...
        </>
      ) : status === "started" ? (
        "Research Started"
      ) : status === "duplicate" ? (
        "Research Already Running"
      ) : status === "error" ? (
        "Research Failed — Retry?"
      ) : (
        <>
          <span className="material-symbols-outlined text-[14px]">science</span>
          Run Research
        </>
      )}
    </button>
  );
}
