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
      <BuilderField label="Home Phone" value={draft.home_phone ?? ""} onChange={(v) => set("home_phone", v)} placeholder="(555) 555-0100" />
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.credit_auth_obtained ?? false}
          onChange={(e) => set("credit_auth_obtained", e.target.checked)}
          className="rounded border-white/15"
        />
        <label className="text-xs text-white/70">Credit authorization obtained</label>
      </div>

      <div className="border-t border-white/10 pt-3 mt-1 space-y-3">
        <div className="text-xs font-semibold text-white/80">Personal History (SBA Form 1244 / 912)</div>
        <BuilderField label="Former Names and Dates Used" value={draft.former_names_and_dates_used ?? ""} onChange={(v) => set("former_names_and_dates_used", v)} placeholder="e.g. Jane Smith (until 2015)" />
        <div className="space-y-1">
          <label className="text-xs font-medium text-white/70">Citizenship Status</label>
          <select
            value={draft.citizenship_status ?? ""}
            onChange={(e) => set("citizenship_status", (e.target.value || undefined) as BorrowerCard["citizenship_status"])}
            className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select…</option>
            <option value="us_citizen">U.S. Citizen</option>
            <option value="us_national">U.S. National</option>
            <option value="lawful_permanent_resident">Lawful Permanent Resident</option>
            <option value="visa_holder">Visa Holder</option>
            <option value="asylee">Asylee</option>
            <option value="refugee">Refugee</option>
            <option value="daca">DACA</option>
            <option value="other_ineligible">Other / Ineligible</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        {draft.citizenship_status && draft.citizenship_status !== "us_citizen" && (
          <BuilderField label="Country of Citizenship" value={draft.country_of_citizenship ?? ""} onChange={(v) => set("country_of_citizenship", v)} />
        )}

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.sba_loan_entity_interest ?? false}
            onChange={(e) => set("sba_loan_entity_interest", e.target.checked)}
            className="rounded border-white/15"
          />
          <label className="text-xs text-white/70">Ownership interest in another entity with existing SBA loans</label>
        </div>
        {draft.sba_loan_entity_interest && (
          <BuilderField label="SBA Loan Numbers and Current Status" value={draft.sba_loan_entity_interest_details ?? ""} onChange={(v) => set("sba_loan_entity_interest_details", v)} type="textarea" />
        )}

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.subject_to_indictment ?? false}
            onChange={(e) => set("subject_to_indictment", e.target.checked)}
            className="rounded border-white/15"
          />
          <label className="text-xs text-white/70">Presently subject to indictment/criminal information/arraignment</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.arrested_or_charged_6mo ?? false}
            onChange={(e) => set("arrested_or_charged_6mo", e.target.checked)}
            className="rounded border-white/15"
          />
          <label className="text-xs text-white/70">Arrested in the last 6 months for any criminal offense</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.convicted_diversion_or_parole ?? false}
            onChange={(e) => set("convicted_diversion_or_parole", e.target.checked)}
            className="rounded border-white/15"
          />
          <label className="text-xs text-white/70">Ever convicted/pleaded guilty or nolo/pretrial diversion/parole (other than a minor vehicle violation)</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.suspended_debarred_ineligible ?? false}
            onChange={(e) => set("suspended_debarred_ineligible", e.target.checked)}
            className="rounded border-white/15"
          />
          <label className="text-xs text-white/70">Presently suspended/debarred/ineligible/excluded from federal participation</label>
        </div>
      </div>

      {draft.ownership_pct != null && draft.ownership_pct > 0 && draft.ownership_pct < 20 && (
        <div className="border-t border-white/10 pt-3 mt-1 space-y-3">
          <div className="text-xs font-semibold text-white/80">Guarantee Limitation (SBA Form 148L)</div>
          <div className="text-[11px] text-white/40">
            Owners under 20% ownership sign a Limited Guarantee instead of an Unconditional Guarantee.
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-white/70">Limitation Type</label>
            <select
              value={draft.guarantee_limitation_type ?? ""}
              onChange={(e) => set("guarantee_limitation_type", (e.target.value || undefined) as BorrowerCard["guarantee_limitation_type"])}
              className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select…</option>
              <option value="balance_reduction">Released when total amount owing drops below</option>
              <option value="principal_reduction">Released when principal balance drops below</option>
              <option value="max_liability">Maximum guarantor payment</option>
              <option value="percentage">Percentage of amounts owing at demand</option>
              <option value="time_based">Years after final disbursement until release</option>
              <option value="collateral">Limited to specific collateral</option>
              <option value="community_property">Community property limitation</option>
            </select>
          </div>
          {draft.guarantee_limitation_type === "balance_reduction" && (
            <BuilderField label="Released When Total Amount Owing Drops Below" value={draft.guarantee_limit_balance_under != null ? String(draft.guarantee_limit_balance_under) : ""} onChange={(v) => set("guarantee_limit_balance_under", v ? Number(v) : undefined)} type="number" />
          )}
          {draft.guarantee_limitation_type === "principal_reduction" && (
            <BuilderField label="Released When Principal Balance Drops Below" value={draft.guarantee_limit_principal_under != null ? String(draft.guarantee_limit_principal_under) : ""} onChange={(v) => set("guarantee_limit_principal_under", v ? Number(v) : undefined)} type="number" />
          )}
          {draft.guarantee_limitation_type === "max_liability" && (
            <BuilderField label="Maximum Guarantor Payment" value={draft.guarantee_limit_max_payment != null ? String(draft.guarantee_limit_max_payment) : ""} onChange={(v) => set("guarantee_limit_max_payment", v ? Number(v) : undefined)} type="number" />
          )}
          {draft.guarantee_limitation_type === "percentage" && (
            <BuilderField label="Percentage of Amounts Owing at Demand" value={draft.guarantee_limit_percent_payment != null ? String(draft.guarantee_limit_percent_payment) : ""} onChange={(v) => set("guarantee_limit_percent_payment", v ? Number(v) : undefined)} type="number" />
          )}
          {draft.guarantee_limitation_type === "time_based" && (
            <BuilderField label="Years After Final Disbursement Until Release" value={draft.guarantee_limit_time_years != null ? String(draft.guarantee_limit_time_years) : ""} onChange={(v) => set("guarantee_limit_time_years", v ? Number(v) : undefined)} type="number" />
          )}
          {draft.guarantee_limitation_type === "collateral" && (
            <BuilderField label="Collateral the Guarantee is Limited To" value={draft.guarantee_limit_collateral_description ?? ""} onChange={(v) => set("guarantee_limit_collateral_description", v)} type="textarea" />
          )}
        </div>
      )}
    </DrawerShell>
  );
}
