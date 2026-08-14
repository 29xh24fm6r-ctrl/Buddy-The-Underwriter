"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GoldenTridentLabClient({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"trident" | "memo" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(kind: "trident" | "memo") {
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
        throw new Error(body.error ?? `Generation failed (${response.status})`);
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
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={busy !== null}
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
  );
}
