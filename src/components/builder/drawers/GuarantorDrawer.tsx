"use client";

import { useState, useEffect } from "react";
import { DrawerShell } from "./DrawerShell";
import { BuilderField } from "../BuilderField";
import type { GuarantorCard, BorrowerCard, GuarantyType } from "@/lib/builder/builderTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  guarantor: GuarantorCard | null;
  owners: BorrowerCard[];
  onSave: (g: GuarantorCard) => void;
};

const GUARANTY_TYPES: { value: GuarantyType; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "limited", label: "Limited" },
  { value: "springing", label: "Springing" },
  { value: "environmental", label: "Environmental" },
];

function blankGuarantor(): GuarantorCard {
  return { id: crypto.randomUUID() };
}

export function GuarantorDrawer({ open, onClose, guarantor, owners, onSave }: Props) {
  const [draft, setDraft] = useState<GuarantorCard>(guarantor ?? blankGuarantor());

  useEffect(() => {
    setDraft(guarantor ?? blankGuarantor());
  }, [guarantor, open]);

  function set<K extends keyof GuarantorCard>(key: K, val: GuarantorCard[K]) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function handleSameAsOwner(ownerId: string) {
    const owner = owners.find((o) => o.id === ownerId);
    if (owner) {
      setDraft((d) => ({
        ...d,
        same_as_borrower_id: ownerId,
        full_legal_name: owner.full_legal_name ?? d.full_legal_name,
      }));
    }
  }

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title={guarantor ? "Edit Guarantor" : "Add Guarantor"}
      onSave={() => { onSave(draft); onClose(); }}
    >
      {owners.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-white/70">Same as existing owner</label>
          <select
            value={draft.same_as_borrower_id ?? ""}
            onChange={(e) => handleSameAsOwner(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Select owner...</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_legal_name || "Unnamed owner"}
              </option>
            ))}
          </select>
        </div>
      )}

      <BuilderField label="Full Legal Name" value={draft.full_legal_name ?? ""} onChange={(v) => set("full_legal_name", v)} />

      <div className="space-y-1">
        <label className="text-xs font-medium text-white/70">Guaranty Type</label>
        <select
          value={draft.guaranty_type ?? ""}
          onChange={(e) => set("guaranty_type", e.target.value as GuarantyType)}
          className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Select...</option>
          {GUARANTY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {draft.guaranty_type === "limited" && (
        <BuilderField label="Guaranty Amount" value={draft.guaranty_amount != null ? String(draft.guaranty_amount) : ""} onChange={(v) => set("guaranty_amount", v ? Number(v) : undefined)} type="number" />
      )}

      <BuilderField label="Net Worth" value={draft.net_worth != null ? String(draft.net_worth) : ""} onChange={(v) => set("net_worth", v ? Number(v) : undefined)} type="number" />
      <BuilderField label="Liquid Assets" value={draft.liquid_assets != null ? String(draft.liquid_assets) : ""} onChange={(v) => set("liquid_assets", v ? Number(v) : undefined)} type="number" />
    </DrawerShell>
  );
}
