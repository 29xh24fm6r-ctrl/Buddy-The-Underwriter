// src/components/borrower/PortalProgressCard.tsx
"use client";

import React from "react";
import type { PortalProgressAndRisk } from "@/lib/borrower/portalTypes";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export default function PortalProgressCard({ progress }: { progress: PortalProgressAndRisk | null }) {
  const pctRaw = typeof progress?.progress_pct === "number" ? progress.progress_pct : 0;
  const pct = clamp(Math.round(pctRaw), 0, 100);

  const uploaded = progress?.uploaded_count ?? null;
  const expected = progress?.expected_count ?? null;

  const missingCritical = progress?.missing_critical_count ?? 0;
  const stale = progress?.stale_items_count ?? 0;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Your progress</div>
        <div className="text-xs text-muted-foreground">{pct}%</div>
      </div>

      <div className="mt-3 h-2 w-full rounded-full bg-muted">
        <div className="h-2 rounded-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-3 text-sm text-muted-foreground">
        {uploaded !== null && expected !== null ? (
          <>
            Uploaded <span className="font-semibold text-foreground">{uploaded}</span> of{" "}
            <span className="font-semibold text-foreground">{expected}</span> items
          </>
        ) : (
          <>Upload a few items to get a personalized checklist.</>
        )}
      </div>

      {(missingCritical > 0 || stale > 0) && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">Important items needed</div>
            <div className="mt-1 text-lg font-semibold">{missingCritical}</div>
          </div>
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">Items may need updating</div>
            <div className="mt-1 text-lg font-semibold">{stale}</div>
          </div>
        </div>
      )}
    </div>
  );
}
