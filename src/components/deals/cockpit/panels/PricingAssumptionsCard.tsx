"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types ───────────────────────────────────────────────────
type RateType = "fixed" | "floating";
type IndexCode = "SOFR" | "UST_5Y" | "PRIME";

type FormState = {
  loan_amount: string;
  rate_type: RateType;
  fixed_rate_pct: string;
  index_code: IndexCode;
  index_rate_pct: string;
  spread_override_bps: string;
  floor_rate_pct: string;
  amort_months: string;
  interest_only_months: string;
  origination_fee_pct: string;
  closing_costs: string;
  include_existing_debt: boolean;
  notes: string;
};

type PricingAssumptions = Record<string, unknown>;

type Status = { kind: "success" | "error" | "info"; message: string } | null;

type Props = {
  dealId: string;
  initial?: PricingAssumptions | null;
  onSave?: () => void;
};

const DEFAULT_FORM: FormState = {
  loan_amount: "",
  rate_type: "floating",
  fixed_rate_pct: "",
  index_code: "SOFR",
  index_rate_pct: "",
  spread_override_bps: "",
  floor_rate_pct: "",
  amort_months: "300",
  interest_only_months: "0",
  origination_fee_pct: "",
  closing_costs: "",
  include_existing_debt: true,
  notes: "",
};

function toFormState(data: PricingAssumptions | null | undefined): FormState {
  if (!data) return { ...DEFAULT_FORM };
  return {
    loan_amount: data.loan_amount != null ? String(data.loan_amount) : "",
    rate_type: (data.rate_type as RateType) ?? "floating",
    fixed_rate_pct: data.fixed_rate_pct != null ? String(data.fixed_rate_pct) : "",
    index_code: (data.index_code as IndexCode) ?? "SOFR",
    index_rate_pct: data.index_rate_pct != null ? String(data.index_rate_pct) : "",
    spread_override_bps: data.spread_override_bps != null ? String(data.spread_override_bps) : "",
    floor_rate_pct: data.floor_rate_pct != null ? String(data.floor_rate_pct) : "",
    amort_months: data.amort_months != null ? String(data.amort_months) : "300",
    interest_only_months:
      data.interest_only_months != null ? String(data.interest_only_months) : "0",
    origination_fee_pct:
      data.origination_fee_pct != null ? String(data.origination_fee_pct) : "",
    closing_costs: data.closing_costs != null ? String(data.closing_costs) : "",
    include_existing_debt: data.include_existing_debt !== false,
    notes: (data.notes as string) ?? "",
  };
}

// ─── PMT math (mirrors server) ──────────────────────────────
function computePreview(form: FormState) {
  const principal = parseFloat(form.loan_amount);
  const amortMonths = parseInt(form.amort_months, 10);
  const ioMonths = parseInt(form.interest_only_months, 10) || 0;

  if (!principal || principal <= 0 || !amortMonths || amortMonths <= 0) {
    return { finalRate: null, monthlyPayment: null, annualDebtService: null };
  }

  let finalRate: number | null = null;
  if (form.rate_type === "fixed") {
    finalRate = parseFloat(form.fixed_rate_pct) || null;
  } else {
    const idx = parseFloat(form.index_rate_pct) || 0;
    const spreadPct = (parseFloat(form.spread_override_bps) || 0) / 100;
    const floor = parseFloat(form.floor_rate_pct) || 0;
    finalRate = Math.max(floor, idx + spreadPct);
  }

  if (finalRate == null || finalRate <= 0) {
    return { finalRate, monthlyPayment: null, annualDebtService: null };
  }

  const r = finalRate / 100 / 12;
  const n = amortMonths;

  let monthlyPayment: number;
  if (ioMonths >= amortMonths) {
    monthlyPayment = (principal * finalRate) / 100 / 12;
  } else if (r === 0) {
    monthlyPayment = principal / n;
  } else {
    monthlyPayment = (principal * r) / (1 - Math.pow(1 + r, -n));
  }

  if (!Number.isFinite(monthlyPayment)) {
    return { finalRate, monthlyPayment: null, annualDebtService: null };
  }

  return {
    finalRate,
    monthlyPayment,
    annualDebtService: monthlyPayment * 12,
  };
}

function formatCurrency(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatPct(n: number | null, decimals = 2): string {
  if (n == null) return "—";
  return `${n.toFixed(decimals)}%`;
}

// ─── Component ──────────────────────────────────────────────
export default function PricingAssumptionsCard({ dealId, initial, onSave }: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(initial));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  // Re-initialize if initial prop changes (e.g., after server re-fetch)
  useEffect(() => {
    if (initial) setForm(toFormState(initial));
  }, [initial]);

  const preview = useMemo(() => computePreview(form), [form]);

  const updateField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setStatus(null);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    try {
      const payload = {
        loan_amount: parseFloat(form.loan_amount) || null,
        rate_type: form.rate_type,
        fixed_rate_pct: form.rate_type === "fixed" ? parseFloat(form.fixed_rate_pct) || null : null,
        index_code: form.index_code,
        index_rate_pct: parseFloat(form.index_rate_pct) || null,
        spread_override_bps:
          form.rate_type === "floating" ? parseFloat(form.spread_override_bps) || null : null,
        floor_rate_pct: parseFloat(form.floor_rate_pct) || null,
        amort_months: parseInt(form.amort_months, 10) || 300,
        interest_only_months: parseInt(form.interest_only_months, 10) || 0,
        term_months: parseInt(form.amort_months, 10) || 120,
        origination_fee_pct: parseFloat(form.origination_fee_pct) || null,
        closing_costs: parseFloat(form.closing_costs) || null,
        include_existing_debt: form.include_existing_debt,
        include_proposed_debt: true,
        notes: form.notes || null,
      };

      const res = await fetch(`/api/deals/${dealId}/pricing-assumptions`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        if (json?.errors?.length) {
          const msgs = (json.errors as Array<{ field: string; message: string }>)
            .map((e) => `${e.field}: ${e.message}`)
            .join("; ");
          throw new Error(msgs);
        }
        throw new Error(json?.error ?? "Failed to save pricing assumptions");
      }

      setStatus({ kind: "success", message: "Pricing assumptions saved." });
      onSave?.();
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Save failed" });
    } finally {
      setSaving(false);
    }
  }, [form, dealId, onSave]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <h3 className="text-sm font-semibold text-white mb-4">Pricing Assumptions</h3>

      {/* ── Row 1: Loan Amount + Rate Type ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Field label="Proposed Loan Amount" required>
          <input
            type="number"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none"
            placeholder="e.g. 2500000"
            value={form.loan_amount}
            onChange={(e) => updateField("loan_amount", e.target.value)}
          />
        </Field>

        <Field label="Rate Type">
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            {(["floating", "fixed"] as RateType[]).map((rt) => (
              <button
                key={rt}
                type="button"
                onClick={() => updateField("rate_type", rt)}
                className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${
                  form.rate_type === rt
                    ? "bg-primary text-white"
                    : "bg-white/5 text-white/50 hover:text-white/70"
                }`}
              >
                {rt === "floating" ? "Floating" : "Fixed"}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* ── Row 2: Rate details ── */}
      {form.rate_type === "fixed" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="Fixed Rate (%)" required>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none"
              placeholder="e.g. 6.50"
              value={form.fixed_rate_pct}
              onChange={(e) => updateField("fixed_rate_pct", e.target.value)}
            />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Field label="Index">
            <select
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              value={form.index_code}
              onChange={(e) => updateField("index_code", e.target.value as IndexCode)}
            >
              <option value="SOFR">SOFR</option>
              <option value="UST_5Y">5Y Treasury</option>
              <option value="PRIME">Prime</option>
            </select>
          </Field>

          <Field label="Index Rate (%)">
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none"
              placeholder="e.g. 4.50"
              value={form.index_rate_pct}
              onChange={(e) => updateField("index_rate_pct", e.target.value)}
            />
          </Field>

          <Field label="Spread (bps)" required>
            <input
              type="number"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none"
              placeholder="e.g. 250"
              value={form.spread_override_bps}
              onChange={(e) => updateField("spread_override_bps", e.target.value)}
            />
          </Field>
        </div>
      )}

      {/* ── Row 3: Floor + Term ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {form.rate_type === "floating" && (
          <Field label="Floor Rate (%)">
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none"
              placeholder="Optional"
              value={form.floor_rate_pct}
              onChange={(e) => updateField("floor_rate_pct", e.target.value)}
            />
          </Field>
        )}

        <Field label="Amortization (months)">
          <input
            type="number"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none"
            value={form.amort_months}
            onChange={(e) => updateField("amort_months", e.target.value)}
          />
        </Field>

        <Field label="Interest-Only (months)">
          <input
            type="number"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none"
            value={form.interest_only_months}
            onChange={(e) => updateField("interest_only_months", e.target.value)}
          />
        </Field>
      </div>

      {/* ── Row 4: Optional fees ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <Field label="Origination Fee (%)">
          <input
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none"
            placeholder="Optional"
            value={form.origination_fee_pct}
            onChange={(e) => updateField("origination_fee_pct", e.target.value)}
          />
        </Field>

        <Field label="Closing Costs ($)">
          <input
            type="number"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none"
            placeholder="Optional"
            value={form.closing_costs}
            onChange={(e) => updateField("closing_costs", e.target.value)}
          />
        </Field>

        <Field label="Include Existing Debt">
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.include_existing_debt}
              onChange={(e) => updateField("include_existing_debt", e.target.checked)}
              className="rounded border-white/20 bg-white/5 text-primary focus:ring-primary"
            />
            <span className="text-xs text-white/60">Include in total debt service</span>
          </label>
        </Field>
      </div>

      {/* ── Notes ── */}
      <div className="mb-4">
        <Field label="Notes">
          <textarea
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-primary focus:outline-none resize-none"
            rows={2}
            placeholder="Optional notes about pricing assumptions"
            value={form.notes}
            onChange={(e) => updateField("notes", e.target.value)}
          />
        </Field>
      </div>

      {/* ── Live Preview ── */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 mb-4">
        <div className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">
          Computed Preview
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-lg font-bold text-white">{formatPct(preview.finalRate)}</div>
            <div className="text-[10px] text-white/40">Final Rate</div>
          </div>
          <div>
            <div className="text-lg font-bold text-white">
              {formatCurrency(preview.monthlyPayment)}
            </div>
            <div className="text-[10px] text-white/40">Monthly P&I</div>
          </div>
          <div>
            <div className="text-lg font-bold text-white">
              {formatCurrency(preview.annualDebtService)}
            </div>
            <div className="text-[10px] text-white/40">Annual Debt Service</div>
          </div>
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center justify-between">
        <div>
          {status && (
            <span
              className={`text-xs ${
                status.kind === "error"
                  ? "text-red-400"
                  : status.kind === "success"
                    ? "text-green-400"
                    : "text-white/50"
              }`}
            >
              {status.message}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-wait transition-colors"
        >
          {saving ? "Saving\u2026" : "Save Assumptions"}
        </button>
      </div>
    </div>
  );
}

// ─── Field wrapper ──────────────────────────────────────────
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-white/50 mb-1">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
