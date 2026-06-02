"use client";

/**
 * SPEC-NAICS-TOOL-MEMO-INPUTS-INTEGRATION-1
 *
 * Shared NAICS suggestion picker. Reuses Buddy's EXISTING endpoint
 * POST /api/deals/[dealId]/recovery/naics-suggest (the same one IgniteWizard
 * calls) — it does NOT introduce a second NAICS/AI system. Surfaces the tool
 * inside Memo Inputs so the research-gate advisory "Set industry classification
 * / NAICS" is actionable where the borrower story is edited.
 *
 * Light-themed for the Memo Inputs surface. The selection-mapping helpers are
 * pure and unit-tested.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export type NaicsSuggestion = {
  naics_code: string;
  naics_description: string;
  confidence: number;
  rationale: string;
};

export type NaicsSelection = {
  naics_code: string | null;
  naics_description: string | null;
  industry_classification: string | null;
  confidence: number | null;
  source: "suggested" | "manual";
  rationale: string | null;
};

// ─── Pure mapping helpers (unit-tested) ──────────────────────────────────────

export function selectionFromSuggestion(s: NaicsSuggestion): NaicsSelection {
  const desc = (s.naics_description ?? "").trim() || null;
  return {
    naics_code: (s.naics_code ?? "").trim() || null,
    naics_description: desc,
    industry_classification: desc,
    confidence: typeof s.confidence === "number" ? s.confidence : null,
    source: "suggested",
    rationale: (s.rationale ?? "").trim() || null,
  };
}

export function selectionFromManual(code: string, description: string): NaicsSelection {
  const d = (description ?? "").trim() || null;
  return {
    naics_code: (code ?? "").trim() || null,
    naics_description: d,
    industry_classification: d,
    confidence: null,
    source: "manual",
    rationale: null,
  };
}

// ─── Component ────────────────────────────────────────────────────────────--

type Props = {
  dealId: string;
  companyName?: string | null;
  businessDescription?: string | null;
  currentNaicsCode?: string | null;
  currentNaicsDescription?: string | null;
  currentIndustryClassification?: string | null;
  onSelect: (selection: NaicsSelection) => void | Promise<void>;
};

export default function NaicsSuggestionPicker({
  dealId,
  companyName,
  businessDescription,
  currentNaicsCode,
  currentNaicsDescription,
  currentIndustryClassification,
  onSelect,
}: Props) {
  const [description, setDescription] = useState<string>(businessDescription ?? "");
  const [suggestions, setSuggestions] = useState<NaicsSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState<string>(currentNaicsCode ?? "");
  const [manualDesc, setManualDesc] = useState<string>(
    currentNaicsDescription ?? currentIndustryClassification ?? "",
  );
  const [savedNaics, setSavedNaics] = useState<string | null>(null);
  const router = useRouter();

  // SPEC-MEMO-INPUTS-IDENTITY-NAICS-RERUN-FRESHNESS-1: persist the selection
  // immediately through the consolidated memo-inputs PUT so research picks it up
  // without depending on a separate "Save story" click. naics_confidence is the
  // model's 0.0–1.0 decimal (existing convention); naics_source is "suggested" |
  // "manual". Then refresh server components so the new value is visible.
  async function persistSelection(sel: NaicsSelection) {
    setError(null);
    void onSelect(sel);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo-inputs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naics_code: sel.naics_code ?? "",
          naics_description: sel.naics_description ?? "",
          industry_classification: sel.industry_classification ?? "",
          naics_source: sel.source,
          naics_confidence: sel.confidence,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError("Saved selection locally, but persisting failed — try Save story.");
        return;
      }
      setSavedNaics(sel.naics_code || sel.naics_description || "industry");
      router.refresh();
    } catch {
      setError("Network error persisting NAICS — try Save story.");
    }
  }

  async function lookup() {
    if (description.trim().length < 10) {
      setError("Describe the business in a bit more detail (min 10 characters).");
      return;
    }
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setSelectedCode(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/recovery/naics-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_description: description.trim(),
          company_name: companyName ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError("Couldn't look up industry — try again.");
        return;
      }
      setSuggestions((data.suggestions ?? []) as NaicsSuggestion[]);
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }

  function pickSuggestion(s: NaicsSuggestion) {
    setSelectedCode(s.naics_code);
    setManualMode(false);
    void persistSelection(selectionFromSuggestion(s));
  }

  function applyManual() {
    if (!manualCode.trim() && !manualDesc.trim()) {
      setError("Enter a NAICS code or an industry description.");
      return;
    }
    void persistSelection(selectionFromManual(manualCode, manualDesc));
  }

  const hasCurrent =
    !!(currentNaicsCode && currentNaicsCode !== "999999") ||
    !!currentNaicsDescription ||
    !!currentIndustryClassification;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Industry Classification / NAICS</h3>
        {hasCurrent ? (
          <span className="text-xs text-emerald-700">
            {currentNaicsCode && currentNaicsCode !== "999999" ? `${currentNaicsCode} · ` : ""}
            {currentNaicsDescription ?? currentIndustryClassification}
          </span>
        ) : (
          <span className="text-xs text-amber-700">Not set</span>
        )}
      </div>
      <p className="mb-2 text-xs text-gray-500">
        Describe what the borrower does — Buddy finds the right industry code. Used by research when
        no NAICS code is on file.
      </p>

      <textarea
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. Business process outsourcing / call center providing customer support to healthcare and enterprise clients…"
        className="mb-2 w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={lookup}
          disabled={loading || description.trim().length < 10}
          className="inline-flex items-center rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? "Buddy is thinking…" : "Find Industry Code"}
        </button>
        <button
          type="button"
          onClick={() => setManualMode((m) => !m)}
          className="text-xs text-gray-600 hover:text-gray-900"
        >
          {manualMode ? "Hide manual entry" : "Enter a code manually"}
        </button>
      </div>

      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      {savedNaics && !error ? (
        <p className="mt-2 text-xs text-emerald-700">Saved {savedNaics} — research will use it on the next run.</p>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Buddy&apos;s suggestions — pick one
          </div>
          {suggestions.map((s) => (
            <button
              key={s.naics_code}
              type="button"
              onClick={() => pickSuggestion(s)}
              className={`w-full rounded-md border p-2.5 text-left transition-colors ${
                selectedCode === s.naics_code
                  ? "border-sky-500 bg-sky-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-gray-900">{s.naics_code}</span>
                  <span className="text-sm text-gray-700">{s.naics_description}</span>
                </div>
                <span
                  className={`text-[11px] font-semibold ${
                    s.confidence >= 0.7
                      ? "text-emerald-600"
                      : s.confidence >= 0.4
                        ? "text-amber-600"
                        : "text-gray-400"
                  }`}
                >
                  {Math.round((s.confidence ?? 0) * 100)}%
                </span>
              </div>
              {s.rationale ? (
                <div className="mt-1 text-xs text-gray-500">{s.rationale}</div>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {manualMode ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-gray-700">
            <span className="mb-1 font-medium">NAICS code</span>
            <input
              type="text"
              maxLength={6}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="6-digit"
              className="w-28 rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-1 flex-col text-xs text-gray-700">
            <span className="mb-1 font-medium">Industry description</span>
            <input
              type="text"
              value={manualDesc}
              onChange={(e) => setManualDesc(e.target.value)}
              placeholder="e.g. Telephone call centers / customer contact center services"
              className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={applyManual}
            className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-700"
          >
            Use this
          </button>
        </div>
      ) : null}
    </div>
  );
}
