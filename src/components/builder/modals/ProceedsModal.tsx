"use client";

import { useState } from "react";
import type { ProceedsCategory, ProceedsItem } from "@/lib/builder/builderTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  items: ProceedsItem[];
  requestedAmount: number;
  onAdd: (item: { category: ProceedsCategory; description?: string; amount: number }) => void;
  onDelete: (id: string) => void;
};

const CATEGORIES: { value: ProceedsCategory; label: string }[] = [
  { value: "equipment", label: "Equipment" },
  { value: "real_estate", label: "Real Estate" },
  { value: "working_capital", label: "Working Capital" },
  { value: "debt_payoff", label: "Debt Payoff" },
  { value: "acquisition", label: "Acquisition" },
  { value: "renovation", label: "Renovation" },
  { value: "other", label: "Other" },
];

export function ProceedsModal({ open, onClose, items, requestedAmount, onAdd, onDelete }: Props) {
  const [cat, setCat] = useState<ProceedsCategory>("working_capital");
  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState("");

  if (!open) return null;

  const total = items.reduce((s, i) => s + (i.amount ?? 0), 0);
  const variance = requestedAmount > 0 ? Math.abs(total - requestedAmount) / requestedAmount : 0;
  const varianceWarning = variance > 0.05;

  function handleAdd() {
    if (!amt || Number(amt) <= 0) return;
    onAdd({ category: cat, description: desc || undefined, amount: Number(amt) });
    setCat("working_capital");
    setDesc("");
    setAmt("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-[min(92vw,600px)] rounded-2xl border border-white/10 bg-[#0f1115] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.6)] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Use of Proceeds</h2>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Existing lines */}
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <div>
                  <span className="text-xs font-semibold text-white/70 capitalize">{item.category.replace("_", " ")}</span>
                  {item.description && <span className="ml-2 text-xs text-white/50">{item.description}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">${Number(item.amount).toLocaleString()}</span>
                  <button type="button" onClick={() => onDelete(item.id)} className="text-rose-400 hover:text-rose-300 text-xs">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Total */}
        <div className="flex items-center justify-between border-t border-white/10 pt-3">
          <span className="text-sm font-semibold text-white">Total</span>
          <span className={`text-sm font-semibold ${varianceWarning ? "text-amber-400" : "text-white"}`}>
            ${total.toLocaleString()}
            {requestedAmount > 0 && (
              <span className="ml-2 text-xs text-white/40">/ ${requestedAmount.toLocaleString()}</span>
            )}
          </span>
        </div>
        {varianceWarning && (
          <div className="text-xs text-amber-400">
            Variance &gt; 5% from requested amount
          </div>
        )}

        {/* Add line */}
        <div className="border-t border-white/10 pt-3 space-y-2">
          <div className="text-xs font-semibold text-white/70">Add Line</div>
          <div className="grid grid-cols-3 gap-2">
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value as ProceedsCategory)}
              className="rounded-lg border border-white/15 bg-white px-2 py-1.5 text-sm text-gray-900"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description"
              className="rounded-lg border border-white/15 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400"
            />
            <input
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              placeholder="Amount"
              type="number"
              className="rounded-lg border border-white/15 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400"
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            + Add Line
          </button>
        </div>

        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">Done</button>
        </div>
      </div>
    </div>
  );
}
