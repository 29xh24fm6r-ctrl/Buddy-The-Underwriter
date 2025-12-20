// src/components/borrower/PortalRequestsList.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { PortalRequestItem } from "@/lib/borrower/portalTypes";

function isComplete(s: string) {
  return String(s || "").toUpperCase() === "COMPLETE";
}

export default function PortalRequestsList({ requests }: { requests: PortalRequestItem[] }) {
  const [showCompleted, setShowCompleted] = useState(false);

  const items = useMemo(() => {
    const sorted = (requests || []).slice().sort((a, b) => {
      const ac = isComplete(a.status);
      const bc = isComplete(b.status);
      if (ac !== bc) return ac ? 1 : -1;
      const ad = a.updated_at || a.created_at || "";
      const bd = b.updated_at || b.created_at || "";
      return bd.localeCompare(ad);
    });

    return showCompleted ? sorted : sorted.filter((r) => !isComplete(r.status));
  }, [requests, showCompleted]);

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Requested items</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Upload the items below — we'll automatically file them correctly.
          </div>
        </div>

        <button
          type="button"
          className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-muted"
          onClick={() => setShowCompleted((v) => !v)}
        >
          {showCompleted ? "Hide completed" : "Show completed"}
        </button>
      </div>

      <div className="mt-4 divide-y rounded-xl border">
        {items.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No items to show.</div>
        ) : (
          items.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{r.title}</div>
                {!!r.description && (
                  <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.description}</div>
                )}
                {!!r.due_date && (
                  <div className="mt-2 text-xs text-muted-foreground">Due: {new Date(r.due_date).toLocaleDateString()}</div>
                )}
              </div>

              <span
                className={[
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold",
                  String(r.status).toUpperCase() === "COMPLETE" ? "bg-muted/40" : "bg-white",
                ].join(" ")}
              >
                {String(r.status).replaceAll("_", " ")}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
