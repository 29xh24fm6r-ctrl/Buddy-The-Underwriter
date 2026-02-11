"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { NextAction } from "@/core/nextStep/types";

export default function NextStepCard({ dealId }: { dealId: string }) {
  const [action, setAction] = useState<NextAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/deals/${dealId}/next-step`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        if (!alive) return;
        setAction(json.nextAction ?? null);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load next step");
        setAction(null);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    if (dealId) load();
    return () => {
      alive = false;
    };
  }, [dealId]);

  const resolveLabel = (next: NextAction): string => {
    if (next.key === "open_underwriting") return "Start underwriting";
    if (next.key === "set_pricing_assumptions") return "Set pricing assumptions";
    if (next.key === "request_docs") return "Upload documents";
    if (next.key === "complete_intake") {
      const missing = next.missing ?? [];
      if (missing.includes("deal_name")) return "Name this deal";
      if (missing.includes("borrower")) return "Attach borrower";
      return "Complete intake";
    }
    return "Next step";
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4">
        <div className="text-base font-semibold text-slate-900">Next Step</div>
        <div className="text-sm text-slate-600">
          One clear action to move the deal forward.
        </div>
      </div>

      <div className="px-4 pb-4">
        {loading && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Loading next step…
          </div>
        )}

        {!loading && err && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Failed to load next step: {err}
          </div>
        )}

        {!loading && !err && action && (
          <div className="space-y-3">
            <Link
              href={action.deepLink}
              className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              {resolveLabel(action)} →
            </Link>

            {action.key !== "open_underwriting" ? (
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <Link
                  href={`/deals/${dealId}/cockpit?anchor=documents`}
                  className="rounded-full border border-slate-200 px-2.5 py-1 hover:bg-slate-50"
                >
                  View checklist
                </Link>
                <Link
                  href={`/deals/${dealId}/pricing`}
                  className="rounded-full border border-slate-200 px-2.5 py-1 hover:bg-slate-50"
                >
                  View pricing
                </Link>
                <Link
                  href={`/credit-memo/${dealId}/draft`}
                  className="rounded-full border border-slate-200 px-2.5 py-1 hover:bg-slate-50"
                >
                  View memo
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
