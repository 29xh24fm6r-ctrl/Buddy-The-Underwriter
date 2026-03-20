"use client";

import { useState } from "react";
import type { CollateralItem, CollateralType } from "@/lib/builder/builderTypes";
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

export function CollateralWorkspace({ collateral, requestedAmount, onAdd, onUpdate, onDelete }: Props) {
  const [modal, setModal] = useState<{ open: boolean; item: CollateralItem | null }>({ open: false, item: null });

  const totalValue = collateral.reduce((s, c) => s + (c.estimated_value ?? 0), 0);
  const coverageRatio = requestedAmount > 0 ? totalValue / requestedAmount : 0;

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
            {collateral.map((item) => (
              <div key={item.id} className={`${glass} flex items-center justify-between`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
                      {TYPE_LABELS[item.item_type] ?? item.item_type}
                    </span>
                    <span className="text-xs text-white/50">Lien: {item.lien_position}</span>
                  </div>
                  <div className="text-sm text-white mt-1">{item.description || "No description"}</div>
                  {item.estimated_value != null && (
                    <div className="text-sm font-semibold text-white mt-0.5">${Number(item.estimated_value).toLocaleString()}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setModal({ open: true, item })} className="text-xs text-primary hover:underline">Edit</button>
                  <button type="button" onClick={() => onDelete(item.id)} className="text-xs text-rose-400 hover:text-rose-300">Delete</button>
                </div>
              </div>
            ))}
          </div>

          <div className={glass}>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Total Collateral Value</span>
              <span className="text-white font-semibold">${totalValue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-white/50">Coverage Ratio</span>
              <span className="text-white font-semibold">{(coverageRatio * 100).toFixed(0)}%</span>
            </div>
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
