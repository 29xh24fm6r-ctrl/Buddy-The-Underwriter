"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * SPEC-COMMITTEE-READY-FLOW-1 — Fix 1 fallback UI.
 *
 * Rendered when /deals/[id]/decision is hit and auto-generation of the
 * proposed snapshot failed (e.g. no financial_snapshot row exists yet).
 * Gives the banker a one-click retry plus a route back to the cockpit.
 */
export function DecisionStartPage({
  dealId,
  error,
}: {
  dealId: string;
  error: string;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleGenerate() {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/decision/generate`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to generate decision");
      }
      router.refresh();
    } catch (err: any) {
      setRetryError(err?.message ?? "Generation failed");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h1 className="text-lg font-semibold">No decision yet</h1>
        <p className="mt-2 text-sm">
          A decision snapshot could not be auto-generated for this deal.
        </p>
        <p className="mt-1 text-xs text-amber-800/80">Reason: {error}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={retrying}
            className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-900/90 disabled:opacity-60"
          >
            {retrying ? "Generating…" : "Generate Decision"}
          </button>
          <Link
            href={`/deals/${dealId}/cockpit`}
            className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            Back to Cockpit
          </Link>
        </div>

        {retryError && (
          <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
            {retryError}
          </div>
        )}
      </div>
    </div>
  );
}
