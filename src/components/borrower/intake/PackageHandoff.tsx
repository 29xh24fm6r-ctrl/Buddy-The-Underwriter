"use client";
import { useState } from "react";

export function PackageHandoff({
  dealId,
  poster,
  onSaved,
}: {
  dealId: string;
  poster?: { posterAvailable: boolean; acknowledged: boolean };
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function acknowledge() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "guided_ack_722",
          dealId,
          confirmed: true,
        }),
      });
      if (!response.ok)
        throw new Error(
          "Your acknowledgment could not be saved. Please retry.",
        );
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-2xl border bg-white p-5">
      <h3 className="text-lg font-semibold">Documents and lender handoff</h3>
      <p className="mt-2 text-sm text-slate-600">
        Your lender reviews the completed application, prepares any business
        tax-transcript requests and closing documents, and confirms the required
        signatures. Saved answers alone do not mark a loan package complete.
      </p>
      <div className="mt-4 rounded-xl bg-slate-50 p-4">
        <h4 className="font-medium">
          SBA Form 722 — Equal Employment Opportunity poster
        </h4>
        <p className="mt-1 text-sm text-slate-600">
          Download and review the poster and its posting instructions.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            className="text-sm text-sky-700 underline"
            href="/sba-templates/SBA_722.pdf"
            target="_blank"
            rel="noreferrer"
          >
            Open the poster
          </a>
          {poster?.acknowledged ? (
            <span className="text-sm text-emerald-700">
              Receipt acknowledged
            </span>
          ) : (
            <button
              type="button"
              className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-40"
              disabled={busy || !poster?.posterAvailable}
              onClick={() => void acknowledge()}
            >
              {busy ? "Saving…" : "I have received and reviewed this poster"}
            </button>
          )}
        </div>
        {error && (
          <p className="mt-2 text-sm text-rose-700" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
