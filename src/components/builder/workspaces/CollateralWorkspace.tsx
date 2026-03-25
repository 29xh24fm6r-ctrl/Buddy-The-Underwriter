"use client";

import { useState } from "react";
import type { CollateralItem } from "@/lib/builder/builderTypes";
import { computeCollateralLtv, getEffectiveAdvanceRate } from "@/lib/builder/collateralLtv";
import { normalizeCollateralItemForBuilder, type NormalizedCollateralItem } from "@/lib/builder/normalizeCollateralItem";
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

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  within_policy: { label: "Within policy", cls: "text-emerald-300 bg-emerald-500/15" },
  needs_advance_rate: { label: "Needs advance rate", cls: "text-yellow-300 bg-yellow-500/15" },
  needs_valuation_method: { label: "Needs valuation method", cls: "text-amber-300 bg-amber-500/15" },
  manual_override: { label: "Manual override", cls: "text-blue-300 bg-blue-500/15" },
  incomplete: { label: "Incomplete", cls: "text-rose-300 bg-rose-500/15" },
};

export function CollateralWorkspace({ collateral, requestedAmount, onAdd, onUpdate, onDelete }: Props) {
  const [modal, setModal] = useState<{ open: boolean; item: CollateralItem | null }>({ open: false, item: null });

  const normalized: NormalizedCollateralItem[] = collateral.map((c) => normalizeCollateralItemForBuilder(c));
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
          {/* Item cards */}
          <div className="space-y-2">
            {normalized.map((item) => {
              const advRate = item.effective_advance_rate ?? getEffectiveAdvanceRate(item);
              const statusStyle = STATUS_STYLES[item.policy_status] ?? STATUS_STYLES.incomplete;
              return (
                <div key={item.id} className={`${glass} flex items-center justify-between`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
                        {TYPE_LABELS[item.item_type] ?? item.item_type}
                      </span>
                      <span className="text-xs text-white/50">Lien: {item.lien_position}</span>
                      {item.valuation_method && (
                        <span className="text-[10px] text-white/40">
                          {VALUATION_LABELS[item.valuation_method] ?? item.valuation_method}
                        </span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusStyle.cls}`}>
                        {statusStyle.label}
                      </span>
                    </div>
                    <div className="text-sm text-white mt-1">{item.description || "No description"}</div>
                    {item.estimated_value != null && (
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-sm font-semibold text-white">${Number(item.estimated_value).toLocaleString()}</span>
                        <span className="text-[10px] text-white/40">
                          Adv. {Math.round(advRate * 100)}%{item.auto_filled.includes("advance_rate") ? " (default)" : ""} = ${Math.round(item.estimated_value * advRate).toLocaleString()}
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

          {/* Item-level policy table */}
          {collateral.length > 1 && (
            <div className={`${glass} overflow-x-auto`}>
              <div className="text-xs font-semibold text-white/50 mb-2">Item-Level Policy Treatment</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/40 border-b border-white/10">
                    <th className="text-left py-1 pr-2">Type</th>
                    <th className="text-right py-1 px-2">Gross</th>
                    <th className="text-left py-1 px-2">Valuation</th>
                    <th className="text-right py-1 px-2">Adv Rate</th>
                    <th className="text-right py-1 px-2">Lendable</th>
                    <th className="text-left py-1 pl-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {normalized.map((item) => {
                    const statusStyle = STATUS_STYLES[item.policy_status] ?? STATUS_STYLES.incomplete;
                    return (
                      <tr key={item.id} className="border-b border-white/5 text-white/70">
                        <td className="py-1 pr-2">{TYPE_LABELS[item.item_type] ?? item.item_type}</td>
                        <td className="text-right py-1 px-2">${(item.estimated_value ?? 0).toLocaleString()}</td>
                        <td className="py-1 px-2">{item.valuation_method ? (VALUATION_LABELS[item.valuation_method] ?? item.valuation_method) : <span className="text-amber-300">Missing</span>}</td>
                        <td className="text-right py-1 px-2">{item.effective_advance_rate != null ? `${Math.round(item.effective_advance_rate * 100)}%` : "—"}</td>
                        <td className="text-right py-1 px-2">{item.computed_lendable_value != null ? `$${item.computed_lendable_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}</td>
                        <td className="py-1 pl-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusStyle.cls}`}>{statusStyle.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* LTV Summary */}
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
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  ltv.withinPolicy
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/20 text-rose-300"
                }`}>
                  {ltv.withinPolicy ? "Within Policy" : "Outside Policy"}
                </span>
                {collateral.length > 1 && (
                  <span className="text-[10px] text-white/30">Based on {collateral.length} items</span>
                )}
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
