"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TridentReadiness } from "@/lib/brokerage/trident/tridentReadiness";

export function GoldenTridentLabClient({
  dealId,
  readiness,
}: {
  dealId: string;
  readiness: TridentReadiness | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"trident" | "memo" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(kind: "trident" | "memo") {
    if (kind === "trident" && !readiness?.ok) {
      setMessage(readiness?.reasons.join(" ") ?? "Readiness could not be established.");
      return;
    }
    setBusy(kind);
    setMessage(null);
    const url = kind === "trident"
      ? `/api/brokerage/deals/${dealId}/trident/generate`
      : `/api/deals/${dealId}/credit-memo/generate`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: kind === "trident" ? JSON.stringify({ mode: "final" }) : undefined,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        const reasons = Array.isArray(body.reasons) ? body.reasons.join(" ") : null;
        throw new Error(reasons || body.error || `Generation failed (${response.status})`);
      }
      setMessage(kind === "trident" ? "Golden Trident artifacts generated." : "Credit memo narrative generated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-black/30 px-2 py-1">Assumptions: {readiness?.evidence.assumptionsStatus ?? "missing"}</span>
        <span className="rounded bg-black/30 px-2 py-1">Documents: {readiness?.evidence.documentCount ?? 0}</span>
        <span className="rounded bg-black/30 px-2 py-1">Financial facts: {readiness?.evidence.financialFactCount ?? 0}</span>
      </div>
      {readiness && !readiness.ok ? (
        <div className="rounded-md border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-200">
          <p className="font-semibold">Not ready for a quality run</p>
          <ul className="mt-1 list-disc pl-5">
            {readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null || !readiness?.ok}
          onClick={() => run("trident")}
          className="rounded-md bg-[#b68b3c] px-4 py-2 text-sm font-semibold text-[#17130d] disabled:opacity-50"
        >
          {busy === "trident" ? "Generating…" : "Generate final Trident"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("memo")}
          className="rounded-md border border-[#b68b3c]/60 px-4 py-2 text-sm font-semibold text-[#f2e9d8] disabled:opacity-50"
        >
          {busy === "memo" ? "Generating…" : "Generate credit memo"}
        </button>
        {message ? <p role="status" className="text-sm text-[#d6c7ae]">{message}</p> : null}
      </div>
    </div>
  );
}
