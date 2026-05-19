"use client";

import { useState } from "react";
import type { DealBorrowerStory } from "@/lib/creditMemo/inputs/types";

type Props = {
  dealId: string;
  initial: DealBorrowerStory | null;
};

const FIELDS: Array<{
  key: keyof Pick<
    DealBorrowerStory,
    | "business_description"
    | "revenue_model"
    | "products_services"
    | "customers"
    | "customer_concentration"
    | "competitive_position"
    | "growth_strategy"
    | "seasonality"
    | "key_risks"
    | "banker_notes"
  >;
  label: string;
  rows: number;
  required?: boolean;
  hint?: string;
}> = [
  { key: "business_description", label: "Business description", rows: 4, required: true, hint: "What does the borrower do? Min 20 chars." },
  { key: "revenue_model", label: "Revenue model", rows: 3, required: true, hint: "How does the borrower earn revenue? Min 10 chars." },
  { key: "products_services", label: "Products / services", rows: 3 },
  { key: "customers", label: "Customer base", rows: 3 },
  { key: "customer_concentration", label: "Customer concentration", rows: 2 },
  { key: "competitive_position", label: "Competitive position", rows: 3 },
  { key: "growth_strategy", label: "Growth strategy", rows: 3 },
  { key: "seasonality", label: "Seasonality", rows: 2 },
  { key: "key_risks", label: "Key risks", rows: 3 },
  { key: "banker_notes", label: "Banker notes", rows: 3 },
];

const EXTRACT_KEYS = FIELDS.map((f) => f.key);

export default function BorrowerStoryForm({ dealId, initial }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = (initial as any)?.[f.key];
      out[f.key] = typeof v === "string" ? v : "";
    }
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Transcript extraction state
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [aiSuggestedKeys, setAiSuggestedKeys] = useState<Set<string>>(new Set());

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo-inputs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "save_failed");
      }
      setSavedAt(new Date().toLocaleTimeString());
      setAiSuggestedKeys(new Set()); // Clear AI highlights on save
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleExtract() {
    if (!transcript.trim()) return;
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo-inputs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "extract-transcript", transcript: transcript.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "extraction_failed");
      }
      const extracted = json.extracted as Record<string, string>;
      const newSuggested = new Set<string>();
      setValues((prev) => {
        const next = { ...prev };
        for (const key of EXTRACT_KEYS) {
          const val = extracted[key];
          if (typeof val === "string" && val.trim()) {
            next[key] = val.trim();
            newSuggested.add(key);
          }
        }
        return next;
      });
      setAiSuggestedKeys(newSuggested);
      setShowTranscript(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  return (
    <section id="borrower-story" className="rounded-lg border border-gray-200 bg-white p-5">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Borrower Story</h2>
          <p className="text-xs text-gray-500">Banker-certified narrative. Required fields gate memo submission.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTranscript(!showTranscript)}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {showTranscript ? "Cancel" : "Extract from transcript"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save story"}
          </button>
        </div>
      </header>

      {/* Transcript extraction panel */}
      {showTranscript && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-xs font-medium text-amber-800">
            Paste your client meeting transcript below. Buddy will extract structured fields automatically.
          </p>
          <textarea
            rows={10}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste transcript here..."
            className="mb-2 w-full rounded-md border border-amber-300 bg-white p-3 text-sm focus:border-amber-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleExtract}
            disabled={extracting || !transcript.trim()}
            className="inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {extracting ? "Extracting…" : "Extract →"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col text-sm text-gray-800">
            <span className="mb-1 font-medium">
              {f.label}
              {f.required ? <span className="ml-1 text-rose-600">*</span> : null}
              {aiSuggestedKeys.has(f.key) ? (
                <span className="ml-2 text-xs text-amber-600">AI-suggested</span>
              ) : null}
            </span>
            <textarea
              rows={f.rows}
              value={values[f.key] ?? ""}
              onChange={(e) =>
                setValues((s) => ({ ...s, [f.key]: e.target.value }))
              }
              className={`w-full rounded-md border p-2 text-sm focus:outline-none ${
                aiSuggestedKeys.has(f.key)
                  ? "border-amber-400 bg-amber-50 focus:border-amber-600"
                  : "border-gray-300 focus:border-gray-500"
              }`}
            />
            {f.hint ? (
              <span className="mt-0.5 text-xs text-gray-500">{f.hint}</span>
            ) : null}
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs">
        {savedAt ? <span className="text-emerald-700">Saved at {savedAt}</span> : null}
        {error ? <span className="text-rose-700">{error}</span> : null}
        {aiSuggestedKeys.size > 0 ? (
          <span className="text-amber-700">
            {aiSuggestedKeys.size} field(s) populated by AI — review before saving
          </span>
        ) : null}
      </div>
    </section>
  );
}
