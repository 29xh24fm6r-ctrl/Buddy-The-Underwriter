"use client";

import { useState } from "react";
import type { DealCollateralItem } from "@/lib/creditMemo/inputs/types";

type Props = {
  dealId: string;
  initial: DealCollateralItem[];
};

const COLLATERAL_TYPES = [
  "real_estate",
  "equipment",
  "ucc_lien",
  "insurance_backed",
  "purchase_target",
  "general",
];

type DraftItem = {
  id?: string;
  collateral_type: string;
  description: string;
  owner_name: string;
  market_value: string;
  appraised_value: string;
  advance_rate: string;
  lien_position: string;
  valuation_date: string;
  valuation_source: string;
  requires_review: boolean;
};

function toDraft(i: DealCollateralItem): DraftItem {
  return {
    id: i.id,
    collateral_type: i.collateral_type ?? "general",
    description: i.description ?? "",
    owner_name: i.owner_name ?? "",
    market_value: i.market_value === null ? "" : String(i.market_value),
    appraised_value: i.appraised_value === null ? "" : String(i.appraised_value),
    advance_rate: i.advance_rate === null ? "" : String(i.advance_rate),
    lien_position: i.lien_position ?? "",
    valuation_date: i.valuation_date ?? "",
    valuation_source: i.valuation_source ?? "",
    requires_review: i.requires_review,
  };
}

const EMPTY_DRAFT: DraftItem = {
  collateral_type: "real_estate",
  description: "",
  owner_name: "",
  market_value: "",
  appraised_value: "",
  advance_rate: "",
  lien_position: "",
  valuation_date: "",
  valuation_source: "",
  requires_review: false,
};

export default function CollateralItemsTable({ dealId, initial }: Props) {
  const [items, setItems] = useState<DraftItem[]>(() => initial.map(toDraft));
  const [draft, setDraft] = useState<DraftItem>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function asPayload(d: DraftItem) {
    return {
      ...(d.id ? { id: d.id } : {}),
      collateral_type: d.collateral_type,
      description: d.description,
      owner_name: d.owner_name,
      market_value: d.market_value.trim() === "" ? null : d.market_value,
      appraised_value: d.appraised_value.trim() === "" ? null : d.appraised_value,
      advance_rate: d.advance_rate.trim() === "" ? null : d.advance_rate,
      lien_position: d.lien_position,
      valuation_date: d.valuation_date.trim() === "" ? null : d.valuation_date,
      valuation_source: d.valuation_source,
      requires_review: d.requires_review,
    };
  }

  async function addItem() {
    if (draft.description.trim().length === 0 || draft.collateral_type.length === 0) {
      setError("Description and collateral type are required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo-inputs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "collateral", ...asPayload(draft) }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save_failed");
      setItems((it) => [...it, toDraft(json.item)]);
      setDraft(EMPTY_DRAFT);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(idx: number) {
    const target = items[idx];
    if (!target.id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo-inputs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "collateral", ...asPayload(target) }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save_failed");
      setItems((it) =>
        it.map((cur, i) => (i === idx ? toDraft(json.item) : cur)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="collateral" className="rounded-lg border border-gray-200 bg-white p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">Collateral</h2>
        <p className="text-xs text-gray-500">
          At least one collateral item with a market or appraised value is required.
        </p>
      </header>

      <div className="space-y-4">
        {items.map((it, idx) => (
          <div key={it.id ?? idx} className="rounded-md border border-gray-200 p-3">
            <ItemFields
              draft={it}
              onChange={(patch) =>
                setItems((cur) =>
                  cur.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
                )
              }
            />
            {it.requires_review ? (
              <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                Requires banker review (low extraction confidence)
              </div>
            ) : null}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => saveItem(idx)}
                disabled={busy}
                className="inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ))}

        <div className="rounded-md border border-dashed border-gray-300 p-3">
          <h3 className="text-sm font-medium text-gray-800">Add collateral item</h3>
          <ItemFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={addItem}
              disabled={busy}
              className="inline-flex items-center rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Add item
            </button>
            {error ? <span className="text-xs text-rose-700">{error}</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function ItemFields({
  draft,
  onChange,
}: {
  draft: DraftItem;
  onChange: (patch: Partial<DraftItem>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <label className="flex flex-col text-sm text-gray-800">
        <span className="mb-1 font-medium">Type</span>
        <select
          value={draft.collateral_type}
          onChange={(e) => onChange({ collateral_type: e.target.value })}
          className="w-full rounded-md border border-gray-300 p-2 text-sm"
        >
          {COLLATERAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <Field label="Description" value={draft.description} onChange={(v) => onChange({ description: v })} />
      <Field label="Owner" value={draft.owner_name} onChange={(v) => onChange({ owner_name: v })} />
      <Field label="Market value" value={draft.market_value} onChange={(v) => onChange({ market_value: v })} />
      <Field label="Appraised value" value={draft.appraised_value} onChange={(v) => onChange({ appraised_value: v })} />
      <Field label="Advance rate" value={draft.advance_rate} onChange={(v) => onChange({ advance_rate: v })} />
      <Field label="Lien position" value={draft.lien_position} onChange={(v) => onChange({ lien_position: v })} />
      <Field
        label="Valuation date"
        value={draft.valuation_date}
        onChange={(v) => onChange({ valuation_date: v })}
        type="date"
      />
      <Field label="Valuation source" value={draft.valuation_source} onChange={(v) => onChange({ valuation_source: v })} />
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col text-sm text-gray-800">
      <span className="mb-1 font-medium">{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 p-2 text-sm"
      />
    </label>
  );
}
