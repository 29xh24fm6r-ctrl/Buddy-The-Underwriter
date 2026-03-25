"use client";

import { useState, useEffect } from "react";
import { BuilderField } from "../BuilderField";
import type { CollateralType, CollateralValuationMethod, CollateralItem } from "@/lib/builder/builderTypes";
import { getEffectiveAdvanceRate } from "@/lib/builder/collateralLtv";

type Props = {
  open: boolean;
  onClose: () => void;
  item: CollateralItem | null;
  onSave: (item: {
    item_type: CollateralType;
    description?: string;
    estimated_value?: number;
    lien_position: number;
    appraisal_date?: string;
    address?: string;
    valuation_method?: CollateralValuationMethod;
    valuation_source_note?: string;
    advance_rate?: number;
    net_lendable_value?: number;
  }) => void;
  onUpdate?: (id: string, item: Partial<CollateralItem>) => void;
};

const COLLATERAL_TYPES: { value: CollateralType; label: string }[] = [
  { value: "real_estate", label: "Real Estate" },
  { value: "equipment", label: "Equipment" },
  { value: "accounts_receivable", label: "Accounts Receivable" },
  { value: "inventory", label: "Inventory" },
  { value: "blanket_lien", label: "Blanket Lien" },
  { value: "vehicle", label: "Vehicle" },
  { value: "other", label: "Other" },
];

const VALUATION_METHODS: { value: CollateralValuationMethod; label: string }[] = [
  { value: "appraisal", label: "Appraisal" },
  { value: "management_stated_value", label: "Management Stated Value" },
  { value: "purchase_price", label: "Purchase Price" },
  { value: "broker_opinion", label: "Broker Opinion of Value" },
  { value: "book_value", label: "Book Value" },
  { value: "tax_assessment", label: "Tax Assessment" },
  { value: "liquidation_estimate", label: "Liquidation Estimate" },
  { value: "other", label: "Other" },
];

export function CollateralModal({ open, onClose, item, onSave, onUpdate }: Props) {
  const [type, setType] = useState<CollateralType>(item?.item_type ?? "real_estate");
  const [description, setDescription] = useState(item?.description ?? "");
  const [value, setValue] = useState(item?.estimated_value != null ? String(item.estimated_value) : "");
  const [lien, setLien] = useState(String(item?.lien_position ?? 1));
  const [appraisal, setAppraisal] = useState(item?.appraisal_date ?? "");
  const [address, setAddress] = useState(item?.address ?? "");
  const [valuationMethod, setValuationMethod] = useState<CollateralValuationMethod | "">(item?.valuation_method ?? "");
  const [valuationNote, setValuationNote] = useState(item?.valuation_source_note ?? "");
  const [advanceRate, setAdvanceRate] = useState(
    item?.advance_rate != null ? String(Math.round(item.advance_rate * 100)) : "",
  );

  useEffect(() => {
    setType(item?.item_type ?? "real_estate");
    setDescription(item?.description ?? "");
    setValue(item?.estimated_value != null ? String(item.estimated_value) : "");
    setLien(String(item?.lien_position ?? 1));
    setAppraisal(item?.appraisal_date ?? "");
    setAddress(item?.address ?? "");
    setValuationMethod(item?.valuation_method ?? "");
    setValuationNote(item?.valuation_source_note ?? "");
    setAdvanceRate(item?.advance_rate != null ? String(Math.round(item.advance_rate * 100)) : "");
  }, [item, open]);

  if (!open) return null;

  const numericValue = value ? Number(value) : 0;
  const effectiveAdvRate = advanceRate ? Number(advanceRate) / 100 : getEffectiveAdvanceRate({ item_type: type } as CollateralItem);
  const computedLendable = numericValue * effectiveAdvRate;

  const needsNote = valuationMethod === "management_stated_value" || valuationMethod === "other";

  function handleSave() {
    const advRateNum = advanceRate ? Number(advanceRate) / 100 : undefined;
    const payload = {
      item_type: type,
      description: description || undefined,
      estimated_value: value ? Number(value) : undefined,
      lien_position: Number(lien) || 1,
      appraisal_date: appraisal || undefined,
      address: address || undefined,
      valuation_method: valuationMethod || undefined,
      valuation_source_note: valuationNote || undefined,
      advance_rate: advRateNum,
      net_lendable_value: value && advRateNum != null ? Number(value) * advRateNum : undefined,
    };
    if (item && onUpdate) {
      onUpdate(item.id, payload);
    } else {
      onSave(payload);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-[min(92vw,520px)] max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f1115] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.6)] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {item ? "Edit Collateral" : "Add Collateral"}
          </h2>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-white/70">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as CollateralType)}
            className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900"
          >
            {COLLATERAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <BuilderField label="Description" value={description} onChange={setDescription} placeholder="Describe the collateral" />
        <BuilderField label="Estimated Gross Value ($)" value={value} onChange={setValue} type="number" />

        {/* Valuation methodology — required for any valued item */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-white/70">Valuation Method</label>
          <select
            value={valuationMethod}
            onChange={(e) => setValuationMethod(e.target.value as CollateralValuationMethod)}
            className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Select method...</option>
            {VALUATION_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {needsNote && (
          <BuilderField
            label="Valuation Source Note"
            value={valuationNote}
            onChange={setValuationNote}
            placeholder={valuationMethod === "management_stated_value"
              ? "e.g. Borrower estimate based on recent comparable sale"
              : "Explain the valuation source"}
          />
        )}

        {/* Advance rate + computed lendable value */}
        <div className="grid grid-cols-2 gap-3">
          <BuilderField
            label="Advance Rate (%)"
            value={advanceRate}
            onChange={setAdvanceRate}
            type="number"
            placeholder={`Default: ${Math.round(getEffectiveAdvanceRate({ item_type: type } as CollateralItem) * 100)}%`}
          />
          <div className="space-y-1">
            <label className="text-xs font-medium text-white/70">Net Lendable Value</label>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60">
              ${computedLendable.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-white/70">Lien Position</label>
          <select
            value={lien}
            onChange={(e) => setLien(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="1">1st</option>
            <option value="2">2nd</option>
            <option value="3">3rd</option>
          </select>
        </div>

        <BuilderField label="Appraisal Date" value={appraisal} onChange={setAppraisal} type="date" />
        {type === "real_estate" && (
          <BuilderField label="Property Address" value={address} onChange={setAddress} placeholder="123 Main St, City, State ZIP" />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5">Cancel</button>
          <button type="button" onClick={handleSave} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">Save</button>
        </div>
      </div>
    </div>
  );
}
