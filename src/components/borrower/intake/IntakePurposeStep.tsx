"use client";

import { useState, useCallback } from "react";
import BorrowerFranchiseBrandPicker from "@/components/brokerage/BorrowerFranchiseBrandPicker";

type PurposeChip = {
  id: string;
  emoji: string;
  label: string;
  featured?: boolean;
  featureTag?: string;
};

const PURPOSES: PurposeChip[] = [
  { id: "franchise", emoji: "🤝", label: "Open a franchise", featured: true, featureTag: "We specialize" },
  { id: "buy_business", emoji: "🏬", label: "Buy a business" },
  { id: "commercial_re", emoji: "🏢", label: "Commercial real estate" },
  { id: "equipment", emoji: "🛠️", label: "Equipment" },
  { id: "working_capital", emoji: "💵", label: "Working capital" },
  { id: "refinance", emoji: "🔁", label: "Refinance debt" },
];

export function IntakePurposeStep({
  dealId,
  initialSelections,
  onContinue,
}: {
  dealId: string;
  initialSelections?: string[];
  onContinue: (purposes: string[], total: number) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelections ?? []),
  );
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [noExistingDebt, setNoExistingDebt] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const total = Object.entries(amounts)
    .filter(([k]) => selected.has(k))
    .reduce((sum, [, v]) => sum + (v || 0), 0);

  const handleContinue = async () => {
    const purposes = Array.from(selected);
    if (purposes.length === 0) return;

    setSaving(true);
    try {
      const factsToSave = [
        { factPath: "loan.use_of_proceeds", value: purposes.join(", ") },
        ...(total ? [{ factPath: "loan.amount_requested", value: String(total) }] : []),
        { factPath: "business.is_franchise", value: String(purposes.includes("franchise")) },
      ];
      for (const { factPath, value } of factsToSave) {
        await fetch("/api/brokerage/concierge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ factPath, value }),
          credentials: "include",
        });
      }
    } catch {
      // non-fatal — continue anyway
    } finally {
      setSaving(false);
    }
    onContinue(purposes, total);
  };

  return (
    <div className="space-y-6">
      {/* Dark gradient hero card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#00081E] via-[#0A1F44] to-[#132a56] px-6 py-10 shadow-[0_24px_60px_rgba(0,8,30,0.35)] sm:px-10 sm:py-14">
        {/* Radial glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(28,141,224,0.15),transparent_70%)]" />
        {/* Dot-grid texture overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative z-10">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            What are you financing?
          </h2>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            Tap everything that applies. If it&apos;s a franchise, tell me the brand.
          </p>
        </div>
      </div>

      {/* Photo panel — pure CSS duotone scene */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0A1F44] to-[#1a3a6a] px-6 py-5">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
        {/* swap for licensed borrower photography in production */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex -space-x-2">
            {[
              "bg-blue-400",
              "bg-emerald-400",
              "bg-amber-400",
            ].map((bg, i) => (
              <div
                key={i}
                className={`h-8 w-8 rounded-full ${bg} border-2 border-[#0A1F44] flex items-center justify-center text-[10px] font-bold text-white`}
              >
                {["F", "R", "W"][i]}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-300">
            Recently funded through Buddy — 3 franchise openings, 2 real estate purchases, 4 working capital lines closed this month.
          </p>
        </div>
      </div>

      {/* Chip grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PURPOSES.map((p) => {
          const isSelected = selected.has(p.id);
          return (
            <div key={p.id} className="space-y-0">
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className={`group relative w-full rounded-2xl border-[1.5px] bg-white px-5 py-5 text-left transition-all duration-200 ${
                  isSelected
                    ? p.featured
                      ? "border-amber-400 shadow-lg shadow-amber-100/50"
                      : "border-brand-blue-500 shadow-lg shadow-blue-100/50"
                    : p.featured
                      ? "border-amber-200 hover:-translate-y-0.5 hover:shadow-lg"
                      : "border-slate-200 hover:-translate-y-0.5 hover:shadow-lg"
                }`}
              >
                {/* Feature tag */}
                {p.featured && (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900">
                    {p.featureTag}
                  </span>
                )}

                <div className="flex items-center gap-3">
                  <span className="text-2xl">{p.emoji}</span>
                  <span className="text-sm font-medium text-slate-900">{p.label}</span>

                  {/* Check-ping animation */}
                  <div className="ml-auto">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300 ${
                        isSelected
                          ? "scale-100 bg-[#0A1F44] opacity-100"
                          : "scale-90 bg-slate-100 opacity-60"
                      }`}
                    >
                      {isSelected && (
                        <svg
                          className="h-3.5 w-3.5 text-white animate-in zoom-in-90 duration-200"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* Amount row — inline expansion */}
              {isSelected && (
                <div className="animate-in slide-in-from-top-2 fade-in duration-300 mt-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
                    {p.label} amount
                  </label>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={amounts[p.id] || ""}
                      onChange={(e) =>
                        setAmounts((prev) => ({
                          ...prev,
                          [p.id]: Number(e.target.value) || 0,
                        }))
                      }
                      placeholder="0"
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-7 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Franchise brand picker — inline when franchise is selected */}
      {selected.has("franchise") && (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300">
          <BorrowerFranchiseBrandPicker startInSearchMode />
        </div>
      )}

      {/* No existing debt checkbox */}
      <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors">
        <input
          type="checkbox"
          checked={noExistingDebt}
          onChange={(e) => setNoExistingDebt(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-blue-500 focus:ring-brand-blue-500"
        />
        <span className="text-sm text-slate-700">No existing business debt</span>
      </label>

      {/* Continue */}
      <div className="flex items-center justify-between pt-2">
        <div>
          {total > 0 && (
            <p className="text-sm text-slate-500">
              Total: <span className="font-semibold text-slate-900">${total.toLocaleString()}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleContinue}
          disabled={selected.size === 0 || saving}
          className="brand-gradient-cta rounded-2xl px-8 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>
    </div>
  );
}
