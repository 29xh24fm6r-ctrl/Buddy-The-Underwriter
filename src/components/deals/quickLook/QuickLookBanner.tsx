"use client";
import { useState } from "react";

interface QuickLookBannerProps {
  dealId: string;
  onUpgraded?: () => void;
}

export function QuickLookBanner({ dealId, onUpgraded }: QuickLookBannerProps) {
  const [upgrading, setUpgrading] = useState(false);
  const [upgraded, setUpgraded] = useState(false);

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/deal-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_mode: "full_underwrite" }),
      });
      if (res.ok) {
        setUpgraded(true);
        onUpgraded?.();
      }
    } finally {
      setUpgrading(false);
    }
  };

  if (upgraded) return null;

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl">
      <div className="flex items-center gap-2.5">
        <span className="material-symbols-outlined text-amber-400 text-[18px] flex-shrink-0">
          preview
        </span>
        <span className="text-sm font-semibold text-amber-300">
          Quick Look — Incomplete Package
        </span>
        <span className="text-sm text-amber-200/60 ml-1">
          Preliminary analysis available. Not committee-ready until upgraded to Full Underwrite.
        </span>
      </div>
      <button
        onClick={handleUpgrade}
        disabled={upgrading}
        className="flex-shrink-0 px-3 py-1 text-xs font-medium rounded-md border border-amber-400/40 text-amber-200 hover:bg-amber-400/10 hover:border-amber-400/70 transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {upgrading ? "Upgrading\u2026" : "Upgrade to Full Underwrite"}
      </button>
    </div>
  );
}
