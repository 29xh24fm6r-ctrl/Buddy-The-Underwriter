"use client";

import { useState, useEffect } from "react";
import { DrawerShell } from "./DrawerShell";
import { BuilderField } from "../BuilderField";
import type { DealSectionData, StructureSectionData, LoanType } from "@/lib/builder/builderTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  deal: Partial<DealSectionData>;
  structure: Partial<StructureSectionData>;
  onSave: (deal: Partial<DealSectionData>, structure: Partial<StructureSectionData>) => void;
};

const LOAN_TYPES: { value: LoanType; label: string }[] = [
  { value: "term_loan", label: "Term Loan" },
  { value: "line_of_credit", label: "Line of Credit" },
  { value: "sba_7a", label: "SBA 7(a)" },
  { value: "sba_504", label: "SBA 504" },
  { value: "usda_b_and_i", label: "USDA B&I" },
  { value: "cre_mortgage", label: "CRE Mortgage" },
  { value: "ci_loan", label: "C&I Loan" },
  { value: "equipment", label: "Equipment" },
  { value: "construction", label: "Construction" },
  { value: "other", label: "Other" },
];

export function LoanRequestDrawer({ open, onClose, deal, structure, onSave }: Props) {
  const [d, setD] = useState<Partial<DealSectionData>>({ ...deal });
  const [s, setS] = useState<Partial<StructureSectionData>>({ ...structure });

  useEffect(() => {
    setD({ ...deal });
    setS({ ...structure });
  }, [deal, structure, open]);

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Loan Request"
      onSave={() => { onSave(d, s); onClose(); }}
    >
      <BuilderField label="Loan Purpose" value={d.loan_purpose ?? ""} onChange={(v) => setD((p) => ({ ...p, loan_purpose: v }))} type="textarea" placeholder="What does the borrower intend to use this loan for?" />
      <BuilderField label="Requested Amount" value={d.requested_amount != null ? String(d.requested_amount) : ""} onChange={(v) => setD((p) => ({ ...p, requested_amount: v ? Number(v) : undefined }))} type="number" />

      <div className="space-y-1">
        <label className="text-xs font-medium text-white/70">Product Type</label>
        <select
          value={d.loan_type ?? ""}
          onChange={(e) => setD((p) => ({ ...p, loan_type: e.target.value as LoanType }))}
          className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Select...</option>
          {LOAN_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <BuilderField label="Desired Term (months)" value={d.desired_term_months != null ? String(d.desired_term_months) : ""} onChange={(v) => setD((p) => ({ ...p, desired_term_months: v ? Number(v) : undefined }))} type="number" />
      <BuilderField label="Amortization (months)" value={d.desired_amortization_months != null ? String(d.desired_amortization_months) : ""} onChange={(v) => setD((p) => ({ ...p, desired_amortization_months: v ? Number(v) : undefined }))} type="number" />
      <BuilderField label="IO Period (months)" value={d.interest_only_months != null ? String(d.interest_only_months) : ""} onChange={(v) => setD((p) => ({ ...p, interest_only_months: v ? Number(v) : undefined }))} type="number" />

      <div className="space-y-1">
        <label className="text-xs font-medium text-white/70">Fixed vs. Floating</label>
        <div className="flex gap-3">
          {(["fixed", "floating"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setD((p) => ({ ...p, fixed_vs_floating: opt }))}
              className={[
                "rounded-lg border px-3 py-1.5 text-sm capitalize",
                d.fixed_vs_floating === opt ? "border-primary bg-primary/20 text-white" : "border-white/15 text-white/60 hover:bg-white/5",
              ].join(" ")}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <BuilderField label="Target Close Date" value={d.target_close_date ?? ""} onChange={(v) => setD((p) => ({ ...p, target_close_date: v }))} type="date" />
      <BuilderField label="Referral Source" value={d.referral_source ?? ""} onChange={(v) => setD((p) => ({ ...p, referral_source: v }))} />
      <BuilderField label="Relationship Manager" value={d.relationship_manager ?? ""} onChange={(v) => setD((p) => ({ ...p, relationship_manager: v }))} />

      <div className="flex items-center gap-2">
        <input type="checkbox" checked={d.existing_bank_customer ?? false} onChange={(e) => setD((p) => ({ ...p, existing_bank_customer: e.target.checked }))} className="rounded border-white/15" />
        <label className="text-xs text-white/70">Existing bank customer</label>
      </div>

      <div className="border-t border-white/10 pt-4 mt-2">
        <div className="text-sm font-semibold text-white mb-3">Deposit Relationship</div>
        {(["deposit_dda", "deposit_treasury", "deposit_payroll", "deposit_merchant"] as const).map((key) => (
          <div key={key} className="flex items-center gap-2 mb-1">
            <input type="checkbox" checked={s[key] ?? false} onChange={(e) => setS((p) => ({ ...p, [key]: e.target.checked }))} className="rounded border-white/15" />
            <label className="text-xs text-white/70 capitalize">{key.replace("deposit_", "")}</label>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 pt-4 mt-2">
        <div className="text-sm font-semibold text-white mb-3">Equity Injection</div>
        <BuilderField label="Amount" value={s.equity_injection_amount != null ? String(s.equity_injection_amount) : ""} onChange={(v) => setS((p) => ({ ...p, equity_injection_amount: v ? Number(v) : undefined }))} type="number" />
        <BuilderField label="Source" value={s.equity_injection_source ?? ""} onChange={(v) => setS((p) => ({ ...p, equity_injection_source: v }))} />
      </div>
    </DrawerShell>
  );
}
