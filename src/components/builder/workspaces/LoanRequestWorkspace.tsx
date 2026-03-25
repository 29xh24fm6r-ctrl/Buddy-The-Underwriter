"use client";

import { useState } from "react";
import type { BuilderState, BuilderPrefill, DealSectionData, StructureSectionData, ProceedsItem, ProceedsCategory, EquityRequirementSource } from "@/lib/builder/builderTypes";
import { LoanRequestDrawer } from "../drawers/LoanRequestDrawer";
import { ProceedsModal } from "../modals/ProceedsModal";
import { BuddySourceBadge } from "../BuddySourceBadge";

type Props = {
  state: BuilderState;
  prefill: BuilderPrefill | null;
  onSectionChange: (sectionKey: string, data: Record<string, unknown>) => void;
  dealId: string;
  proceeds: ProceedsItem[];
  onProceedsAdd: (item: { category: ProceedsCategory; description?: string; amount: number }) => void;
  onProceedsDelete: (id: string) => void;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

const LOAN_TYPE_LABELS: Record<string, string> = {
  term_loan: "Term Loan", line_of_credit: "Line of Credit", sba_7a: "SBA 7(a)",
  sba_504: "SBA 504", usda_b_and_i: "USDA B&I", cre_mortgage: "CRE Mortgage",
  ci_loan: "C&I Loan", equipment: "Equipment", construction: "Construction", other: "Other",
};

export function LoanRequestWorkspace({ state, prefill, onSectionChange, dealId, proceeds, onProceedsAdd, onProceedsDelete }: Props) {
  const deal = (state.sections.deal ?? {}) as Partial<DealSectionData>;
  const structure = (state.sections.structure ?? {}) as Partial<StructureSectionData>;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [proceedsOpen, setProceedsOpen] = useState(false);

  function handleDrawerSave(d: Partial<DealSectionData>, s: Partial<StructureSectionData>) {
    onSectionChange("deal", { ...deal, ...d });
    onSectionChange("structure", { ...structure, ...s });
  }

  const requestedAmt = deal.requested_amount ?? 0;
  const deposits = [
    structure.deposit_dda && "DDA",
    structure.deposit_treasury && "Treasury",
    structure.deposit_payroll && "Payroll",
    structure.deposit_merchant && "Merchant",
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <div className={glass}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white">Loan Request</div>
          <button type="button" onClick={() => setDrawerOpen(true)} className="text-xs text-primary hover:underline">Edit</button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-white/50">Product</span>
            <div className="flex items-center gap-2">
              <span className="text-white font-medium">{deal.loan_type ? LOAN_TYPE_LABELS[deal.loan_type] ?? deal.loan_type : "\u2014"}</span>
              <BuddySourceBadge source={prefill?.sources["deal.loan_type"]} />
            </div>
          </div>
          <div>
            <span className="text-white/50">Amount</span>
            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-lg">{requestedAmt > 0 ? `$${requestedAmt.toLocaleString()}` : "\u2014"}</span>
              <BuddySourceBadge source={prefill?.sources["deal.requested_amount"]} />
            </div>
          </div>
          <div>
            <span className="text-white/50">Term</span>
            <span className="text-white font-medium">{deal.desired_term_months ? `${deal.desired_term_months} mo` : "\u2014"}</span>
          </div>
          <div>
            <span className="text-white/50">Purpose</span>
            <span className="text-white font-medium">{deal.loan_purpose?.slice(0, 80) ?? "\u2014"}</span>
          </div>
          <div>
            <span className="text-white/50">Close Date</span>
            <span className="text-white font-medium">{deal.target_close_date ?? "\u2014"}</span>
          </div>
          <div>
            <span className="text-white/50">Deposits</span>
            <div className="flex flex-wrap gap-1">
              {deposits.length > 0
                ? deposits.map((d) => (
                    <span key={d as string} className="rounded-full border border-emerald-500/30 bg-emerald-600/10 px-2 py-0.5 text-[10px] text-emerald-300">{d} &#10003;</span>
                  ))
                : <span className="text-white/40">\u2014</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Equity Compliance */}
      <EquityComplianceCard structure={structure} requestedAmt={requestedAmt} />

      {/* Use of Proceeds */}
      <div className={glass}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white">Use of Proceeds</div>
          <button type="button" onClick={() => setProceedsOpen(true)} className="text-xs text-primary hover:underline">Edit Proceeds</button>
        </div>
        {proceeds.length === 0 ? (
          <div className="text-xs text-white/40">No proceeds lines added yet.</div>
        ) : (
          <div className="space-y-1">
            {proceeds.map((p) => (
              <div key={p.id} className="flex justify-between text-xs">
                <span className="text-white/70 capitalize">{p.category.replace("_", " ")}</span>
                <span className="text-white">${Number(p.amount).toLocaleString()}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs font-semibold border-t border-white/10 pt-1 mt-1">
              <span className="text-white">Total</span>
              <span className="text-white">${proceeds.reduce((s, p) => s + p.amount, 0).toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      <LoanRequestDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} deal={deal} structure={structure} onSave={handleDrawerSave} />
      <ProceedsModal open={proceedsOpen} onClose={() => setProceedsOpen(false)} items={proceeds} requestedAmount={requestedAmt} onAdd={onProceedsAdd} onDelete={onProceedsDelete} />
    </div>
  );
}

// ── Equity Compliance sub-component ──────────────────────────────

const SOURCE_LABELS: Record<EquityRequirementSource, string> = {
  bank_policy: "Bank Policy",
  product_default: "Product Default",
  manual_override: "Manual Override",
};

function EquityComplianceCard({ structure, requestedAmt }: { structure: Partial<StructureSectionData>; requestedAmt: number }) {
  const hasEquity =
    structure.equity_required_pct != null ||
    structure.equity_actual_pct != null ||
    structure.equity_injection_amount != null;

  if (!hasEquity) return null;

  const reqPct = structure.equity_required_pct;
  const actPct = structure.equity_actual_pct;
  const reqAmt = structure.equity_required_amount ?? (reqPct != null && requestedAmt > 0 ? requestedAmt * reqPct : null);
  const actAmt = structure.equity_actual_amount ?? structure.equity_injection_amount ?? (actPct != null && requestedAmt > 0 ? requestedAmt * actPct : null);
  const source = structure.equity_requirement_source;

  // Status
  let statusLabel = "Missing Inputs";
  let statusCls = "text-white/50 bg-white/5";
  if (actAmt != null && reqAmt != null) {
    if (actAmt >= reqAmt) {
      statusLabel = "Meets Requirement";
      statusCls = "text-emerald-300 bg-emerald-500/15";
    } else {
      statusLabel = "Below Requirement";
      statusCls = "text-rose-300 bg-rose-500/15";
    }
  } else if (reqPct == null && actAmt != null) {
    statusLabel = "Not Required";
    statusCls = "text-white/50 bg-white/5";
  } else if (requestedAmt <= 0) {
    statusLabel = "Awaiting transaction base";
    statusCls = "text-yellow-300/60 bg-yellow-500/10";
  }

  const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

  return (
    <div className={glass}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white">Equity Requirement</div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>
          {statusLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-white/50">Required %</span>
          <div className="text-white font-medium">{reqPct != null ? `${(reqPct * 100).toFixed(0)}%` : "\u2014"}</div>
        </div>
        <div>
          <span className="text-white/50">Required $</span>
          <div className="text-white font-medium">{reqAmt != null ? `$${reqAmt.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "\u2014"}</div>
        </div>
        <div>
          <span className="text-white/50">Proposed %</span>
          <div className="text-white font-medium">{actPct != null ? `${(actPct * 100).toFixed(0)}%` : "\u2014"}</div>
        </div>
        <div>
          <span className="text-white/50">Proposed $</span>
          <div className="text-white font-medium">{actAmt != null ? `$${actAmt.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "\u2014"}</div>
        </div>
        <div>
          <span className="text-white/50">Source of Funds</span>
          <div className="text-white font-medium">{structure.equity_injection_source || "\u2014"}</div>
        </div>
        <div>
          <span className="text-white/50">Requirement Source</span>
          <div className="text-white/70 text-xs">{source ? SOURCE_LABELS[source] : "\u2014"}</div>
        </div>
      </div>
      {structure.equity_policy_reference && (
        <div className="mt-2 text-[10px] text-white/30">Policy: {structure.equity_policy_reference}</div>
      )}
    </div>
  );
}
