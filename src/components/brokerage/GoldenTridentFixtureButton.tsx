"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GoldenTridentFixtureButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createFixture() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/brokerage/command-center", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "seed_golden_trident_qa" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.dealId) throw new Error(body.error ?? `Fixture failed (${response.status})`);
      router.push(`/admin/brokerage/packages?lab=golden-trident&dealId=${encodeURIComponent(body.dealId)}`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={createFixture} className="rounded-md bg-[#b68b3c] px-4 py-2 text-sm font-semibold text-[#17130d] disabled:opacity-50">
        {busy ? "Preparing QA deal…" : "Create or open governed QA deal"}
      </button>
      <p className="text-xs text-[#a99b84]">Creates inputs only; every artifact must be produced by the live engines.</p>
      {error ? <p role="alert" className="w-full text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
