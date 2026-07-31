"use client";

import { useState, useCallback } from "react";
import { CapturedFactsPanel } from "@/components/brokerage/CapturedFactsPanel";

type VerifiedInfo = {
  legalName: string | null;
  ein: string | null;
  address: string | null;
};

type VerifyStatus = "idle" | "searching" | "found" | "not_found" | "error";

export function IntakeBusinessStep({
  dealId,
  onContinue,
}: {
  dealId: string;
  onContinue: () => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [verified, setVerified] = useState<VerifiedInfo | null>(null);
  const [facts, setFacts] = useState<Record<string, unknown>>({});
  const [showEdit, setShowEdit] = useState(false);

  const search = useCallback(async () => {
    const text = query.trim();
    if (!text) return;
    setStatus("searching");
    try {
      const res = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          factPath: "business.legal_name_or_industry",
          value: text,
        }),
        credentials: "include",
      });
      const json = await res.json();
      if (json?.ok) {
        const f = json.extractedFacts ?? {};
        setFacts(f);
        const legalName = (f["business.entity_name"] ?? f["business.legal_name_or_industry"] ?? text) as string;
        const ein = (f["business.ein"] ?? null) as string | null;
        const address = (f["business.address"] ?? null) as string | null;
        setVerified({ legalName, ein, address });
        setStatus("found");
      } else {
        setStatus("not_found");
      }
    } catch {
      setStatus("error");
    }
  }, [dealId, query]);

  return (
    <div className="space-y-6">
      {/* Buddy bubble */}
      <div className="flex gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-500 to-brand-blue-400 text-sm font-bold text-white">
          B
        </div>
        <div className="rounded-2xl rounded-bl-md bg-slate-100 px-5 py-3.5">
          <p className="text-sm text-slate-800">
            Give me your business name or EIN and I&apos;ll pull what&apos;s on record — you just confirm it&apos;s right.
          </p>
        </div>
      </div>

      {/* Search input */}
      {status !== "found" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Business name or EIN
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  search();
                }
              }}
              placeholder="e.g. Acme LLC or 12-3456789"
              className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
              disabled={status === "searching"}
            />
            <button
              type="button"
              onClick={search}
              disabled={!query.trim() || status === "searching"}
              className="brand-gradient-cta rounded-xl px-5 py-3 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
            >
              {status === "searching" ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Looking up…
                </span>
              ) : (
                "Look up"
              )}
            </button>
          </div>
          {status === "not_found" && (
            <p className="mt-3 text-sm text-amber-700">
              No match found. Try a different name or EIN, or continue to enter details manually.
            </p>
          )}
          {status === "error" && (
            <p className="mt-3 text-sm text-red-600">
              Something went wrong. Please try again.
            </p>
          )}
        </div>
      )}

      {/* Verified card */}
      {status === "found" && verified && !showEdit && (
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500">
              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Business Verified</h3>
          </div>

          <div className="space-y-3">
            <VerifiedRow
              label="Legal name"
              value={verified.legalName}
              badge="VERIFIED"
              badgeColor="emerald"
            />
            {verified.ein && (
              <VerifiedRow
                label="EIN"
                value={verified.ein}
                badge="MATCHED"
                badgeColor="emerald"
              />
            )}
            {verified.address && (
              <VerifiedRow
                label="Address"
                value={verified.address}
                badge="VERIFIED"
                badgeColor="emerald"
              />
            )}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onContinue}
              className="brand-gradient-cta rounded-2xl px-6 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110"
            >
              Yes, that&apos;s us →
            </button>
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Something&apos;s wrong
            </button>
          </div>
        </div>
      )}

      {/* Edit mode via CapturedFactsPanel */}
      {showEdit && (
        <div className="space-y-4">
          <CapturedFactsPanel facts={facts} onCorrected={setFacts} />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowEdit(false)}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Back to verified card
            </button>
            <button
              type="button"
              onClick={onContinue}
              className="brand-gradient-cta rounded-2xl px-6 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110"
            >
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VerifiedRow({
  label,
  value,
  badge,
  badgeColor,
}: {
  label: string;
  value: string | null;
  badge: string;
  badgeColor: "emerald" | "blue";
}) {
  if (!value) return null;
  const colors =
    badgeColor === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-blue-50 text-blue-700 border-blue-200";
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
      <div>
        <span className="text-xs text-slate-500">{label}</span>
        <p className="text-sm font-medium text-slate-900">{value}</p>
      </div>
      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${colors}`}>
        {badge}
      </span>
    </div>
  );
}
