"use client";

import { useState, useEffect } from "react";
import { DrawerShell } from "./DrawerShell";
import { BuilderField } from "../BuilderField";
import type { BorrowerCard } from "@/lib/builder/builderTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  owner: BorrowerCard | null;
  onSave: (owner: BorrowerCard) => void;
};

function blankOwner(): BorrowerCard {
  return { id: crypto.randomUUID() };
}

export function OwnerDrawer({ open, onClose, owner, onSave }: Props) {
  const [draft, setDraft] = useState<BorrowerCard>(owner ?? blankOwner());

  useEffect(() => {
    setDraft(owner ?? blankOwner());
  }, [owner, open]);

  function set<K extends keyof BorrowerCard>(key: K, val: BorrowerCard[K]) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title={owner ? "Edit Owner" : "Add Owner"}
      onSave={() => { onSave(draft); onClose(); }}
    >
      <BuilderField label="Full Legal Name" value={draft.full_legal_name ?? ""} onChange={(v) => set("full_legal_name", v)} placeholder="Jane Doe" />
      <BuilderField label="Title / Role" value={draft.title ?? ""} onChange={(v) => set("title", v)} placeholder="CEO, Managing Member, etc." />
      <BuilderField label="Ownership %" value={draft.ownership_pct != null ? String(draft.ownership_pct) : ""} onChange={(v) => set("ownership_pct", v ? Number(v) : undefined)} type="number" placeholder="25" min={0} />
      <BuilderField label="Date of Birth" value={draft.dob ?? ""} onChange={(v) => set("dob", v)} type="date" />
      <BuilderField label="SSN Last 4" value={draft.ssn_last4 ?? ""} onChange={(v) => set("ssn_last4", v.slice(0, 4))} placeholder="1234" maxLength={4} />
      <BuilderField label="Home Address" value={draft.home_address ?? ""} onChange={(v) => set("home_address", v)} placeholder="123 Main St" />
      <div className="grid grid-cols-3 gap-2">
        <BuilderField label="City" value={draft.home_city ?? ""} onChange={(v) => set("home_city", v)} />
        <BuilderField label="State" value={draft.home_state ?? ""} onChange={(v) => set("home_state", v)} />
        <BuilderField label="ZIP" value={draft.home_zip ?? ""} onChange={(v) => set("home_zip", v)} />
      </div>
      <BuilderField label="Years with Company" value={draft.years_with_company != null ? String(draft.years_with_company) : ""} onChange={(v) => set("years_with_company", v ? Number(v) : undefined)} type="number" />
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.credit_auth_obtained ?? false}
          onChange={(e) => set("credit_auth_obtained", e.target.checked)}
          className="rounded border-white/15"
        />
        <label className="text-xs text-white/70">Credit authorization obtained</label>
      </div>
    </DrawerShell>
  );
}
