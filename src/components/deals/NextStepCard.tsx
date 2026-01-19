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

  const labelMap: Record<NextAction["key"], string> = {
    complete_intake: "Complete Intake",
    request_docs: "Request Docs",
    run_pricing: "Run Pricing",
    open_underwriting: "Open Underwriting",
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
              {labelMap[action.key]} →
            </Link>

            <div className="flex flex-wrap gap-2 text-xs text-slate-500">
              <Link
                href={`/deals/${dealId}/documents`}
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
          </div>
        )}
      </div>
    </div>
  );
}
