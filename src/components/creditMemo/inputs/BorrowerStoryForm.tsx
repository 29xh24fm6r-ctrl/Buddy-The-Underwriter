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

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo-inputs/borrower-story`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "save_failed");
      }
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="borrower-story" className="rounded-lg border border-gray-200 bg-white p-5">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Borrower Story</h2>
          <p className="text-xs text-gray-500">Banker-certified narrative. Required fields gate memo submission.</p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save story"}
        </button>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col text-sm text-gray-800">
            <span className="mb-1 font-medium">
              {f.label}
              {f.required ? <span className="ml-1 text-rose-600">*</span> : null}
            </span>
            <textarea
              rows={f.rows}
              value={values[f.key] ?? ""}
              onChange={(e) =>
                setValues((s) => ({ ...s, [f.key]: e.target.value }))
              }
              className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-gray-500 focus:outline-none"
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
      </div>
    </section>
  );
}
