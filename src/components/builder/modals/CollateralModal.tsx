"use client";

import { useState, useEffect } from "react";
import { BuilderField } from "../BuilderField";
import type { CollateralType, CollateralItem } from "@/lib/builder/builderTypes";

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

export function CollateralModal({ open, onClose, item, onSave, onUpdate }: Props) {
  const [type, setType] = useState<CollateralType>(item?.item_type ?? "real_estate");
  const [description, setDescription] = useState(item?.description ?? "");
  const [value, setValue] = useState(item?.estimated_value != null ? String(item.estimated_value) : "");
  const [lien, setLien] = useState(String(item?.lien_position ?? 1));
  const [appraisal, setAppraisal] = useState(item?.appraisal_date ?? "");
  const [address, setAddress] = useState(item?.address ?? "");

  useEffect(() => {
    setType(item?.item_type ?? "real_estate");
    setDescription(item?.description ?? "");
    setValue(item?.estimated_value != null ? String(item.estimated_value) : "");
    setLien(String(item?.lien_position ?? 1));
    setAppraisal(item?.appraisal_date ?? "");
    setAddress(item?.address ?? "");
  }, [item, open]);

  if (!open) return null;

  function handleSave() {
    const payload = {
      item_type: type,
      description: description || undefined,
      estimated_value: value ? Number(value) : undefined,
      lien_position: Number(lien) || 1,
      appraisal_date: appraisal || undefined,
      address: address || undefined,
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
      <div className="relative z-10 w-[min(92vw,520px)] rounded-2xl border border-white/10 bg-[#0f1115] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.6)] space-y-4">
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
        <BuilderField label="Estimated Value ($)" value={value} onChange={setValue} type="number" />

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
