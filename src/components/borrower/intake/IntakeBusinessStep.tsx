"use client";

import { useState, useCallback } from "react";
import { CapturedFactsPanel } from "@/components/brokerage/CapturedFactsPanel";

type VerifiedInfo = {
  legalName: string | null;
  ein: string | null;
  address: string | null;
};

type VerifyStatus = "idle" | "searching" | "found" | "not_found" | "error";
type Mode = "choose" | "existing" | "startup";

const ENTITY_TYPE_OPTIONS = [
  { value: "", label: "Select entity type…" },
  { value: "LLC", label: "LLC" },
  { value: "Corporation", label: "Corporation" },
  { value: "S-Corporation", label: "S-Corporation" },
  { value: "Partnership", label: "Partnership" },
  { value: "Sole Proprietorship", label: "Sole Proprietorship" },
];

export function IntakeBusinessStep({
  dealId,
  isStartup,
  onContinue,
}: {
  dealId: string;
  isStartup?: boolean;
  onContinue: (data?: Record<string, unknown>) => void;
}) {
  const [mode, setMode] = useState<Mode>(isStartup ? "startup" : "choose");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [verified, setVerified] = useState<VerifiedInfo | null>(null);
  const [facts, setFacts] = useState<Record<string, unknown>>({});
  const [showEdit, setShowEdit] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [startupName, setStartupName] = useState("");
  const [startupSaving, setStartupSaving] = useState(false);

  const [entityType, setEntityType] = useState("");
  const [naicsCode, setNaicsCode] = useState("");
  // ~48% of SBA size standards (483 of 996 rows in the current 121.201
  // table) are measured in employees, not receipts. Without headcount those
  // deals resolve to `needs_information` and can never seal, so it is asked
  // for here rather than discovered as a blocker at the review step.
  const [employeeCount, setEmployeeCount] = useState("");
  const [showDetailsCapture, setShowDetailsCapture] = useState(false);
  const [detailsSaving, setDetailsSaving] = useState(false);

  const canContinueDetails = entityType !== "" && naicsCode.trim().length >= 2;

  const saveDetailsAndContinue = async () => {
    setDetailsSaving(true);
    try {
      const factsToSave = [
        { factPath: "business.entity_type", value: entityType },
        { factPath: "business.naics", value: naicsCode.trim() },
        ...(employeeCount.trim() !== ""
          ? [{ factPath: "business.employee_count", value: employeeCount.trim() }]
          : []),
      ];
      for (const { factPath, value } of factsToSave) {
        await fetch("/api/brokerage/concierge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ factPath, value }),
          credentials: "include",
        });
      }
    } catch {
      // non-fatal — facts may still be correctable later
    } finally {
      setDetailsSaving(false);
    }
    onContinue({
      entityType,
      naicsCode: naicsCode.trim(),
      // Empty stays undefined rather than 0: "not answered" and "zero
      // employees" are different, and only the latter is an answer.
      employeeCount:
        employeeCount.trim() === "" ? undefined : Number(employeeCount.trim()),
    });
  };

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

  const handleStartupContinue = async () => {
    setStartupSaving(true);
    try {
      const name = startupName.trim() || "New business (name TBD)";
      const factsToSave = [
        { factPath: "business.legal_name_or_industry", value: name },
        { factPath: "business.is_startup", value: "true" },
      ];
      for (const { factPath, value } of factsToSave) {
        await fetch("/api/brokerage/concierge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ factPath, value }),
          credentials: "include",
        });
      }
    } catch {
      // non-fatal
    } finally {
      setStartupSaving(false);
    }
    setShowDetailsCapture(true);
  };

  // --- Choose mode ---
  if (mode === "choose") {
    return (
      <div className="space-y-6">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-500 to-brand-blue-400 text-sm font-bold text-white">
            B
          </div>
          <div className="rounded-2xl rounded-bl-md bg-slate-100 px-5 py-3.5">
            <p className="text-sm text-slate-800">
              Tell me about your business — is it already registered, or are you starting something new?
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("existing")}
            className="rounded-2xl border-[1.5px] border-slate-200 bg-white px-5 py-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏢</span>
              <div>
                <span className="text-sm font-medium text-slate-900">It&apos;s already registered</span>
                <p className="mt-0.5 text-xs text-slate-500">I have a business name, EIN, or both</p>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("startup")}
            className="rounded-2xl border-[1.5px] border-amber-200 bg-white px-5 py-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🌱</span>
              <div>
                <span className="text-sm font-medium text-slate-900">I&apos;m starting something new</span>
                <p className="mt-0.5 text-xs text-slate-500">No registration or EIN yet — that&apos;s fine</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // --- Details capture (entity type + NAICS) ---
  if (showDetailsCapture) {
    return (
      <div className="space-y-6">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-500 to-brand-blue-400 text-sm font-bold text-white">
            B
          </div>
          <div className="rounded-2xl rounded-bl-md bg-slate-100 px-5 py-3.5">
            <p className="text-sm text-slate-800">
              Two more quick details so I can check SBA eligibility for you.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Type of business entity
            </label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
            >
              {ENTITY_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              NAICS code
            </label>
            <input
              type="text"
              value={naicsCode}
              onChange={(e) => setNaicsCode(e.target.value)}
              placeholder="e.g. 722511"
              maxLength={6}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              6-digit industry code — look yours up at{" "}
              <a
                href="https://www.census.gov/naics/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-blue-500 hover:text-brand-blue-400"
              >
                census.gov/naics
              </a>
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Number of employees
            </label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={employeeCount}
              onChange={(e) => setEmployeeCount(e.target.value)}
              placeholder="e.g. 18"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Include yourself and any part-time staff. Many SBA size standards
              are measured in employees rather than revenue.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setShowDetailsCapture(false)}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={saveDetailsAndContinue}
            disabled={!canContinueDetails || detailsSaving}
            className="brand-gradient-cta rounded-2xl px-8 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50"
          >
            {detailsSaving ? "Saving…" : "Continue →"}
          </button>
        </div>
      </div>
    );
  }

  // --- Startup mode ---
  if (mode === "startup") {
    return (
      <div className="space-y-6">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-500 to-brand-blue-400 text-sm font-bold text-white">
            B
          </div>
          <div className="rounded-2xl rounded-bl-md bg-slate-100 px-5 py-3.5">
            <p className="text-sm text-slate-800">
              Great — what will the business be called? A working name is fine.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Business name (working name is fine)
          </label>
          <input
            type="text"
            value={startupName}
            onChange={(e) => setStartupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleStartupContinue();
              }
            }}
            placeholder="e.g. My Coffee Shop"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
          />
        </div>

        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-5 py-4">
          <p className="text-sm font-medium text-emerald-800">No EIN, registration, or tax returns needed right now.</p>
          <p className="mt-1 text-xs text-emerald-700">
            Startups are a supported SBA borrower segment. We&apos;ll build projections from your business plan instead of historical financials.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleStartupContinue}
            disabled={startupSaving}
            className="brand-gradient-cta rounded-2xl px-8 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50"
          >
            {startupSaving ? "Saving…" : "Continue →"}
          </button>
        </div>
      </div>
    );
  }

  // --- Existing mode ---
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
      {status !== "found" && !showManualEntry && (
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
              No match found. Try a different name or EIN, or use the options below to continue.
            </p>
          )}
          {status === "error" && (
            <p className="mt-3 text-sm text-red-600">
              Something went wrong. Please try again, or use the options below to continue.
            </p>
          )}
        </div>
      )}

      {/* Always-visible escape hatches */}
      {status !== "found" && !showManualEntry && (
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <button
            type="button"
            onClick={() => setShowManualEntry(true)}
            className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Enter details myself
          </button>
          <button
            type="button"
            onClick={() => setMode("startup")}
            className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            I don&apos;t have an EIN yet
          </button>
        </div>
      )}

      {/* Manual entry via CapturedFactsPanel */}
      {showManualEntry && status !== "found" && (
        <div className="space-y-4 animate-in slide-in-from-top-2 fade-in duration-300">
          <CapturedFactsPanel facts={facts} onCorrected={setFacts} />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowManualEntry(false)}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setShowDetailsCapture(true)}
              className="brand-gradient-cta rounded-2xl px-6 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* Confirm card (replaces old "Business Verified" card) */}
      {status === "found" && verified && !showEdit && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-blue-500">
              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Here&apos;s what I found — does this look right?</h3>
          </div>

          <div className="space-y-3">
            <InfoRow label="Legal name" value={verified.legalName} />
            {verified.ein && <InfoRow label="EIN" value={verified.ein} />}
            {verified.address && <InfoRow label="Address" value={verified.address} />}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setShowDetailsCapture(true)}
              className="brand-gradient-cta rounded-2xl px-6 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110"
            >
              Yes, that&apos;s us →
            </button>
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Something&apos;s off
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
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setShowDetailsCapture(true)}
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

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
      <div>
        <span className="text-xs text-slate-500">{label}</span>
        <p className="text-sm font-medium text-slate-900">{value}</p>
      </div>
    </div>
  );
}
