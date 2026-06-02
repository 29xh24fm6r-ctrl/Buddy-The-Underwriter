"use client";

/**
 * SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
 *
 * Entity Identity section for Memo Inputs. Captures the deal-level legal name /
 * DBA / website / HQ / banker-certified identity summary that the research
 * engine needs to (a) avoid externally "verifying" a placeholder deal name and
 * (b) run the private-company research path. Writes through the existing
 * memo-inputs PUT (upsertBorrowerStory) — one row per deal, partial patch.
 *
 * NAICS lives in the Borrower Story's NaicsSuggestionPicker; this form is the
 * identity layer that sits above it.
 */

import { useState } from "react";
import type { DealBorrowerStory } from "@/lib/creditMemo/inputs/types";

type Props = {
  dealId: string;
  initial: DealBorrowerStory | null;
};

const FIELDS: Array<{
  key: "legal_name" | "dba" | "website" | "hq_city" | "hq_state" | "banker_identity_summary";
  label: string;
  rows: number;
  hint?: string;
}> = [
  { key: "legal_name", label: "Legal borrower name", rows: 1, hint: "Exact legal entity name — used as the research search target instead of the deal name." },
  { key: "dba", label: "DBA / trade name", rows: 1, hint: "Any name the business operates under, if different from the legal name." },
  { key: "website", label: "Website", rows: 1, hint: "Primary URL — a strong public identity anchor for research." },
  { key: "hq_city", label: "HQ city", rows: 1 },
  { key: "hq_state", label: "HQ state", rows: 1 },
  { key: "banker_identity_summary", label: "Banker-certified identity summary", rows: 3, hint: "Who this borrower is, in your words. Anchors the private-company research path." },
];

export default function EntityIdentityForm({ dealId, initial }: Props) {
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
      const res = await fetch(`/api/deals/${dealId}/memo-inputs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save_failed");
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="entity-identity" className="rounded-lg border border-gray-200 bg-white p-5">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Entity Identity</h2>
          <p className="text-xs text-gray-500">
            Tells research who the borrower actually is. Without a legal name / DBA / website, research
            will not search the web for a placeholder deal name.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save identity"}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col text-sm text-gray-800">
            <span className="mb-1 font-medium">{f.label}</span>
            {f.rows > 1 ? (
              <textarea
                rows={f.rows}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
              />
            ) : (
              <input
                type="text"
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
              />
            )}
            {f.hint ? <span className="mt-0.5 text-xs text-gray-500">{f.hint}</span> : null}
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
