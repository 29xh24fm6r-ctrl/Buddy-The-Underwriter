"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { DealScopedTarget } from "@/lib/navigation/resolveDealScopedRoute";
import { setLastDealId } from "@/lib/navigation/resolveDealScopedRoute";

type Deal = {
  id: string;
  name: string | null;
  borrower_name: string | null;
  stage: string | null;
};

export function DealPickerModal({
  target,
  onClose,
}: {
  target: DealScopedTarget;
  onClose: () => void;
}) {
  const router = useRouter();
  const [deals, setDeals] = React.useState<Deal[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/deals?limit=20&sort=updated_at");
        const json = await res.json();
        if (!cancelled && Array.isArray(json.deals)) {
          setDeals(json.deals);
        }
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = search.trim()
    ? deals.filter((d) => {
        const q = search.toLowerCase();
        return (
          (d.name ?? "").toLowerCase().includes(q) ||
          (d.borrower_name ?? "").toLowerCase().includes(q)
        );
      })
    : deals;

  function selectDeal(dealId: string) {
    setLastDealId(dealId);
    router.push(`/deals/${dealId}/${target}`);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Select a deal"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            Select a deal to open {target.replace(/-/g, " ")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/50 hover:text-white text-lg leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <input
          type="text"
          placeholder="Search deals…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none"
          autoFocus
        />

        <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
          {loading ? (
            <div className="py-4 text-center text-xs text-white/40">Loading deals…</div>
          ) : filtered.length === 0 ? (
            <div className="py-4 text-center text-xs text-white/40">
              {search ? "No matching deals" : "No deals found. Create a deal first."}
            </div>
          ) : (
            filtered.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => selectDeal(d.id)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10 transition"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">
                    {d.name || d.borrower_name || "Untitled deal"}
                  </div>
                  {d.borrower_name && d.name && (
                    <div className="truncate text-xs text-white/50">{d.borrower_name}</div>
                  )}
                </div>
                {d.stage && (
                  <span className="ml-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
                    {d.stage}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
