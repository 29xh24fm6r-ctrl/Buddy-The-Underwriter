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
  const [busy, setBusy] = useState<"trident" | "analysis" | "memo" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function waitForTrident(bundleId: string) {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const response = await fetch(`/api/brokerage/deals/${dealId}/trident/generate`, {
        method: "GET",
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        throw new Error(body.error || `Status check failed (${response.status})`);
      }
      if (body.bundle?.id !== bundleId) continue;
      if (body.bundle.status === "succeeded") return;
      if (body.bundle.status === "failed") {
        throw new Error(body.bundle.generation_error || "Generation failed");
      }
      const stage = body.bundle?.current_stage ? String(body.bundle.current_stage).replace(/_/g, " ") : "factory";
      setMessage(`Golden Trident is running: ${stage}. You may leave this page.`);
    }
    throw new Error("Generation is still running after 30 minutes. It will continue in the background; reload this deal to check status.");
  }

  async function run(kind: "trident" | "analysis" | "memo") {
    if (kind === "trident" && !readiness?.ok) {
      setMessage(readiness?.reasons.join(" ") ?? "Readiness could not be established.");
      return;
    }
    setBusy(kind);
    setMessage(null);
    const url = kind === "trident"
      ? `/api/brokerage/deals/${dealId}/trident/generate`
      : kind === "analysis"
        ? `/api/deals/${dealId}/banker-analysis/run`
        : `/api/deals/${dealId}/credit-memo/generate`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: kind === "trident"
          ? JSON.stringify({ mode: "final" })
          : kind === "analysis"
            ? JSON.stringify({ reason: "admin_replay", forceRun: true })
            : undefined,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        const reasons = Array.isArray(body.reasons) ? body.reasons.join(" ") : null;
        throw new Error(reasons || body.error || `Generation failed (${response.status})`);
      }
      if (kind === "analysis" && body.result?.status !== "succeeded") {
        const blockers = Array.isArray(body.result?.blockers) ? body.result.blockers.join(", ") : "";
        throw new Error(body.result?.message || blockers || `AI assessment ${body.result?.status ?? "did not complete"}`);
      }
      if (kind === "analysis" && body.validation?.gatingDecision === "BLOCK_GENERATION") {
        const blockingChecks = Array.isArray(body.validation?.checks)
          ? body.validation.checks
              .filter((check: { status?: unknown }) => check.status === "BLOCK")
              .map((check: { message?: unknown }) => String(check.message ?? "Validation blocked generation."))
              .join(" ")
          : "";
        throw new Error(blockingChecks || body.validation?.summary || "Deterministic validation blocked generation.");
      }
      if (kind === "trident" && response.status === 202 && body.bundleId) {
        setMessage("Golden Trident accepted. Durable generation is running in the background.");
        await waitForTrident(body.bundleId);
      }
      setMessage(
        kind === "trident"
          ? "Golden Trident artifacts generated successfully."
          : kind === "analysis"
            ? `AI risk assessment and deterministic validation completed (${body.validation?.overallStatus ?? "status unavailable"}).`
            : "Credit memo narrative generated.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      router.refresh();
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
        <span className="rounded bg-black/30 px-2 py-1">Uses: {readiness?.evidence.useOfProceedsCount ?? 0}</span>
        <span className="rounded bg-black/30 px-2 py-1">Validation: {readiness?.evidence.validationStatus ?? "not run"}</span>
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
          disabled={busy !== null}
          onClick={() => run("analysis")}
          className="rounded-md border border-[#b68b3c]/60 px-4 py-2 text-sm font-semibold text-[#f2e9d8] disabled:opacity-50"
        >
          {busy === "analysis" ? "Running assessment…" : "Run AI assessment"}
        </button>
        <button
          type="button"
          disabled={busy !== null || !readiness?.ok}
          onClick={() => run("trident")}
          className="rounded-md bg-[#b68b3c] px-4 py-2 text-sm font-semibold text-[#17130d] disabled:opacity-50"
        >
          {busy === "trident" ? "Generating in background…" : "Generate final Trident"}
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
