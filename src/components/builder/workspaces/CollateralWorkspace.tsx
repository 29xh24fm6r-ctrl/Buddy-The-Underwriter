"use client";

import { useState } from "react";
import type { CollateralItem } from "@/lib/builder/builderTypes";
import { computeCollateralLtv, getEffectiveAdvanceRate } from "@/lib/builder/collateralLtv";
import { CollateralModal } from "../modals/CollateralModal";

type Props = {
  collateral: CollateralItem[];
  requestedAmount: number;
  onAdd: (item: Omit<CollateralItem, "id" | "deal_id" | "created_at" | "updated_at">) => void;
  onUpdate: (id: string, item: Partial<CollateralItem>) => void;
  onDelete: (id: string) => void;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

const TYPE_LABELS: Record<string, string> = {
  real_estate: "Real Estate", equipment: "Equipment", accounts_receivable: "A/R",
  inventory: "Inventory", blanket_lien: "Blanket Lien", vehicle: "Vehicle", other: "Other",
};

const VALUATION_LABELS: Record<string, string> = {
  appraisal: "Appraisal", management_stated_value: "Mgmt Stated Value",
  purchase_price: "Purchase Price", broker_opinion: "Broker Opinion",
  book_value: "Book Value", tax_assessment: "Tax Assessment",
  liquidation_estimate: "Liquidation Est.", other: "Other",
};

export function CollateralWorkspace({ collateral, requestedAmount, onAdd, onUpdate, onDelete }: Props) {
  const [modal, setModal] = useState<{ open: boolean; item: CollateralItem | null }>({ open: false, item: null });

  const ltv = computeCollateralLtv(collateral, requestedAmount);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Collateral Package</div>
        <button
          type="button"
          onClick={() => setModal({ open: true, item: null })}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          + Add Collateral
        </button>
      </div>

      {collateral.length === 0 ? (
        <div className={`${glass} text-center text-sm text-white/40`}>
          No collateral items added yet.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {collateral.map((item) => {
              const advRate = getEffectiveAdvanceRate(item);
              return (
                <div key={item.id} className={`${glass} flex items-center justify-between`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
                        {TYPE_LABELS[item.item_type] ?? item.item_type}
                      </span>
                      <span className="text-xs text-white/50">Lien: {item.lien_position}</span>
                      {item.valuation_method && (
                        <span className="text-[10px] text-white/40">
                          {VALUATION_LABELS[item.valuation_method] ?? item.valuation_method}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-white mt-1">{item.description || "No description"}</div>
                    {item.estimated_value != null && (
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-sm font-semibold text-white">${Number(item.estimated_value).toLocaleString()}</span>
                        <span className="text-[10px] text-white/40">
                          Adv. {Math.round(advRate * 100)}% = ${Math.round(item.estimated_value * advRate).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setModal({ open: true, item })} className="text-xs text-primary hover:underline">Edit</button>
                    <button type="button" onClick={() => onDelete(item.id)} className="text-xs text-rose-400 hover:text-rose-300">Delete</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* LTV Summary — replaces old "Coverage Ratio" */}
          <div className={glass}>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Gross Collateral Value</span>
              <span className="text-white font-semibold">${ltv.totalGrossValue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-white/50">Net Lendable Value</span>
              <span className="text-white font-semibold">${ltv.totalLendableValue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-white/50">Loan to Value (LTV)</span>
              <span className={`font-semibold ${ltv.withinPolicy === false ? "text-rose-400" : "text-white"}`}>
                {ltv.ltv !== null ? `${(ltv.ltv * 100).toFixed(1)}%` : "—"}
              </span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-white/50">Policy Limit</span>
              <span className="text-white/70">{ltv.policyLimit !== null ? `${(ltv.policyLimit * 100).toFixed(0)}%` : "—"}</span>
            </div>
            {ltv.withinPolicy !== null && (
              <div className="mt-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  ltv.withinPolicy
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/20 text-rose-300"
                }`}>
                  {ltv.withinPolicy ? "Within Policy" : "Outside Policy"}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <CollateralModal
        open={modal.open}
        onClose={() => setModal({ open: false, item: null })}
        item={modal.item}
        onSave={onAdd as any}
        onUpdate={onUpdate}
      />
    </div>
  );
}
