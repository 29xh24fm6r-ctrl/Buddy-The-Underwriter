"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSpreadOutput } from "@/hooks/useSpreadOutput";
import { usePricingInputs } from "@/hooks/usePricingInputs";

// ─── Math ───────────────────────────────────────────────────────────────────

function computeMonthlyPI(
  loanAmount: number,
  annualRatePct: number,
  amortMonths: number,
): number {
  if (loanAmount <= 0 || amortMonths <= 0) return 0;
  if (annualRatePct <= 0) return loanAmount / amortMonths;
  const r = annualRatePct / 100 / 12;
  const n = amortMonths;
  return (loanAmount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function computeADS(
  loanAmount: number,
  annualRatePct: number,
  amortMonths: number,
  ioMonths: number,
): number {
  if (loanAmount <= 0) return 0;
  const ioMonthlyPayment = (loanAmount * annualRatePct) / 100 / 12;
  const piMonthlyPayment = computeMonthlyPI(loanAmount, annualRatePct, amortMonths);
  if (ioMonths >= 12) return ioMonthlyPayment * 12;
  return ioMonths * ioMonthlyPayment + (12 - ioMonths) * piMonthlyPayment;
}

function computeDSCR(ncads: number | null, ads: number): number | null {
  if (ncads == null || ads <= 0) return null;
  return ncads / ads;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function fmtDollars(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "\u2014";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)
    return `${sign}$${Math.round(abs / 1_000).toLocaleString("en-US")}K`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function fmtX(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "\u2014";
  return `${n.toFixed(2)}x`;
}

function dscrColor(n: number | null): string {
  if (n == null) return "text-white/60";
  if (n >= 1.25) return "text-emerald-400";
  if (n >= 1.0) return "text-amber-400";
  return "text-rose-400";
}

function dscrBg(n: number | null): string {
  if (n == null) return "";
  if (n >= 1.25) return "bg-emerald-950/30 border-emerald-500/30";
  if (n >= 1.0) return "bg-amber-950/30 border-amber-500/30";
  return "bg-rose-950/30 border-rose-500/30";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function OutputCell({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: string;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 flex flex-col gap-0.5 ${highlight ?? "border-white/10 bg-white/5"}`}
    >
      <span className="text-[10px] uppercase tracking-wide text-white/50">
        {label}
      </span>
      <span
        className={`font-semibold text-xl leading-tight ${highlight ? "" : "text-white"}`}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-white/40 mt-0.5">{sub}</span>}
    </div>
  );
}

function PolicyBreach({
  label,
  breached,
}: {
  label: string;
  breached: boolean;
}) {
  if (!breached) return null;
  return (
    <div className="border-l-2 border-rose-500 bg-rose-950/20 rounded-r-lg px-3 py-2 text-xs text-rose-300">
      &loz; Policy: {label}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  displayValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  displayValue: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/60">{label}</span>
        <span className="text-xs font-semibold text-white tabular-nums">
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-white/10 accent-primary"
      />
      <div className="flex justify-between text-[9px] text-white/30">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

const POLICY_MAX_LEVERAGE = 4.5;
const POLICY_MIN_DSCR = 1.2;
const POLICY_MIN_DSCR_HARD = 1.0;

export default function StructureClient({ dealId }: { dealId: string }) {
  const { data: spread, loading: spreadLoading } = useSpreadOutput(dealId);
  const { data: savedInputs, loading: inputsLoading } = usePricingInputs(dealId);

  const facts = spread?.canonical_facts ?? {};
  const ratios = spread?.ratios ?? {};
  const years = (spread?.years_available ?? []).sort((a, b) => a - b);
  const latestYear = years.length > 0 ? years[years.length - 1] : null;

  const ncads = latestYear ? toNum(facts[`cf_ncads_${latestYear}`]) : null;
  const ebitda = latestYear ? toNum(facts[`EBITDA_${latestYear}`]) : null;
  void ratios; // consumed via ncads/ebitda from facts

  // Initialize sliders from saved inputs
  const defaultLoan = toNum(savedInputs?.loan_amount) ?? 600_000;
  const defaultRate =
    savedInputs?.base_rate_override_pct != null &&
    savedInputs?.spread_override_bps != null
      ? savedInputs.base_rate_override_pct + savedInputs.spread_override_bps / 100
      : savedInputs?.base_rate_override_pct ?? 6.5;
  const defaultAmort = savedInputs?.amort_months ?? 120;
  const defaultTerm = savedInputs?.term_months ?? 120;
  const defaultIO = savedInputs?.interest_only_months ?? 0;

  const [loan, setLoan] = useState<number>(defaultLoan);
  const [rate, setRate] = useState<number>(defaultRate);
  const [amort, setAmort] = useState<number>(defaultAmort);
  const [termMonths, setTermMonths] = useState<number>(defaultTerm);
  const [ioMonths, setIoMonths] = useState<number>(defaultIO);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!inputsLoading && savedInputs && !initialized) {
      setLoan(toNum(savedInputs.loan_amount) ?? 600_000);
      const allIn =
        savedInputs.base_rate_override_pct != null &&
        savedInputs.spread_override_bps != null
          ? savedInputs.base_rate_override_pct +
            savedInputs.spread_override_bps / 100
          : savedInputs.base_rate_override_pct ?? 6.5;
      setRate(allIn);
      setAmort(savedInputs.amort_months ?? 120);
      setTermMonths(savedInputs.term_months ?? 120);
      setIoMonths(savedInputs.interest_only_months ?? 0);
      setInitialized(true);
    }
  }, [inputsLoading, savedInputs, initialized]);

  // ── Live computations ────────────────────────────────────────────────────
  const ads = computeADS(loan, rate, amort, ioMonths);
  const monthlyPayment = computeMonthlyPI(loan, rate, amort);
  const dscr = computeDSCR(ncads, ads);

  // Saved structure for comparison
  const savedAds =
    savedInputs != null
      ? computeADS(
          toNum(savedInputs.loan_amount) ?? 0,
          defaultRate,
          savedInputs.amort_months ?? 120,
          savedInputs.interest_only_months ?? 0,
        )
      : null;
  const savedDscr = savedAds != null ? computeDSCR(ncads, savedAds) : null;

  // Coverage table
  const coverageScenarios = [
    { label: "Base Case", ncadsMultiplier: 1.0 },
    { label: "Downside (\u221210%)", ncadsMultiplier: 0.9 },
    { label: "Stress (\u221220%)", ncadsMultiplier: 0.8 },
  ].map(({ label, ncadsMultiplier }) => {
    const scenarioNcads = ncads != null ? ncads * ncadsMultiplier : null;
    const scenarioDscr = computeDSCR(scenarioNcads, ads);
    return { label, ncads: scenarioNcads, ads, dscr: scenarioDscr };
  });

  // Policy breaches
  const breachDscr = dscr != null && dscr < POLICY_MIN_DSCR;
  const breachDscrHard = dscr != null && dscr < POLICY_MIN_DSCR_HARD;
  const breachLeverage =
    ebitda != null && ebitda > 0 ? loan / ebitda > POLICY_MAX_LEVERAGE : false;

  // Breakeven
  const breakevenDeclinePct =
    dscr != null && ncads != null && ncads > 0 && dscr > 1.0
      ? Math.round(((dscr - 1.0) / dscr) * 100)
      : null;

  // ── Loading guard ────────────────────────────────────────────────────────
  if (spreadLoading) {
    return (
      <div className="px-6 py-12 text-center text-sm text-white/40">
        Loading deal structure\u2026
      </div>
    );
  }

  if (!ncads && !ebitda) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-white/60 mb-3">
          Financial data required. Set pricing assumptions and ensure documents
          are extracted.
        </p>
        <Link
          href={`/deals/${dealId}/pricing-memo`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
        >
          Set Pricing Assumptions &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-6">
      {/* ── Saved Structure Summary ───────────────────────────────────────── */}
      {savedInputs && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
          <div className="text-[10px] uppercase tracking-wide text-white/40 mb-3">
            Saved Structure
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-white/50 text-xs">Loan Amount </span>
              <span className="text-white font-semibold">
                {fmtDollars(toNum(savedInputs.loan_amount))}
              </span>
            </div>
            <div>
              <span className="text-white/50 text-xs">Rate </span>
              <span className="text-white font-semibold">
                {defaultRate.toFixed(2)}%
              </span>
            </div>
            <div>
              <span className="text-white/50 text-xs">Amort </span>
              <span className="text-white font-semibold">
                {savedInputs.amort_months ?? "\u2014"} mo
              </span>
            </div>
            <div>
              <span className="text-white/50 text-xs">Term </span>
              <span className="text-white font-semibold">
                {savedInputs.term_months ?? "\u2014"} mo
              </span>
            </div>
            <div>
              <span className="text-white/50 text-xs">IO </span>
              <span className="text-white font-semibold">
                {savedInputs.interest_only_months ?? 0} mo
              </span>
            </div>
            {savedDscr != null && (
              <div>
                <span className="text-white/50 text-xs">Saved DSCR </span>
                <span className={`font-semibold ${dscrColor(savedDscr)}`}>
                  {fmtX(savedDscr)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Two-column layout: Sliders | Live Outputs ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sliders */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4 space-y-5">
          <div className="text-[10px] uppercase tracking-wide text-white/40">
            Structure Parameters
          </div>

          <SliderRow
            label="Loan Amount"
            value={loan}
            min={50_000}
            max={25_000_000}
            step={25_000}
            onChange={setLoan}
            displayValue={fmtDollars(loan)}
          />
          <SliderRow
            label="All-In Rate (%)"
            value={rate}
            min={3.0}
            max={14.0}
            step={0.25}
            onChange={setRate}
            displayValue={`${rate.toFixed(2)}%`}
          />
          <SliderRow
            label="Amortization (months)"
            value={amort}
            min={60}
            max={360}
            step={12}
            onChange={setAmort}
            displayValue={`${amort} mo (${(amort / 12).toFixed(0)} yr)`}
          />
          <SliderRow
            label="Loan Term (months)"
            value={termMonths}
            min={12}
            max={360}
            step={12}
            onChange={setTermMonths}
            displayValue={`${termMonths} mo (${(termMonths / 12).toFixed(0)} yr)`}
          />
          <SliderRow
            label="Interest-Only Period (months)"
            value={ioMonths}
            min={0}
            max={60}
            step={6}
            onChange={setIoMonths}
            displayValue={ioMonths === 0 ? "None" : `${ioMonths} mo`}
          />

          <div className="pt-2 border-t border-white/5">
            <Link
              href={`/deals/${dealId}/pricing-memo`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90"
            >
              Save Assumptions &rarr;
            </Link>
            <p className="text-[10px] text-white/30 mt-2">
              This view is read-only. Save assumptions in Pricing to persist.
            </p>
          </div>
        </div>

        {/* Live Outputs */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <OutputCell
              label="Monthly P&I"
              value={fmtDollars(monthlyPayment)}
              sub={
                ioMonths > 0
                  ? `IO first ${ioMonths} mo`
                  : "Full amortization"
              }
            />
            <OutputCell
              label="Annual Debt Service"
              value={fmtDollars(ads)}
              sub="First year (blended)"
            />
            <OutputCell
              label="DSCR"
              value={fmtX(dscr)}
              sub={
                ncads != null
                  ? `NCADS ${fmtDollars(ncads)}`
                  : "NCADS unavailable"
              }
              highlight={`border ${dscrBg(dscr)} ${dscr != null ? (dscr >= 1.25 ? "text-emerald-300" : dscr >= 1.0 ? "text-amber-300" : "text-rose-300") : "text-white"}`}
            />
            <OutputCell
              label="Covenant Headroom"
              value={
                breakevenDeclinePct != null
                  ? `Rev \u2193${breakevenDeclinePct}%`
                  : "\u2014"
              }
              sub="Until DSCR breaks 1.0x"
            />
          </div>

          {/* Policy breaches */}
          <div className="space-y-2">
            <PolicyBreach
              label="DSCR below policy minimum (1.20x)"
              breached={breachDscr && !breachDscrHard}
            />
            <PolicyBreach
              label="DSCR below 1.0x \u2014 hard stop"
              breached={breachDscrHard}
            />
            <PolicyBreach
              label={`Leverage ${ebitda != null ? (loan / ebitda).toFixed(1) : "\u2014"}x exceeds ${POLICY_MAX_LEVERAGE}x policy`}
              breached={breachLeverage}
            />
            {!breachDscr && !breachLeverage && dscr != null && (
              <div className="border-l-2 border-emerald-500 bg-emerald-950/20 rounded-r-lg px-3 py-2 text-xs text-emerald-300">
                &check; No policy breaches at current structure
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Coverage Table ────────────────────────────────────────────────── */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-white/40 mb-2">
          Coverage &mdash; Revenue Stress Scenarios
        </div>
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                  Scenario
                </th>
                <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                  NCADS
                </th>
                <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                  ADS
                </th>
                <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                  DSCR
                </th>
              </tr>
            </thead>
            <tbody>
              {coverageScenarios.map((s, i) => (
                <tr
                  key={s.label}
                  className={`border-t border-white/[0.06] ${i === 0 ? "bg-white/[0.04]" : ""}`}
                >
                  <td
                    className={`px-4 py-2.5 ${i === 0 ? "text-white font-semibold" : "text-white/70"}`}
                  >
                    {s.label}
                  </td>
                  <td
                    className={`text-right px-4 py-2.5 tabular-nums ${i === 0 ? "text-white font-semibold" : "text-white/70"}`}
                  >
                    {fmtDollars(s.ncads)}
                  </td>
                  <td
                    className={`text-right px-4 py-2.5 tabular-nums ${i === 0 ? "text-white font-semibold" : "text-white/70"}`}
                  >
                    {fmtDollars(s.ads)}
                  </td>
                  <td
                    className={`text-right px-4 py-2.5 tabular-nums font-semibold ${dscrColor(s.dscr)}`}
                  >
                    {fmtX(s.dscr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Assumptions Note ─────────────────────────────────────────────── */}
      <div className="text-xs text-white/30 border-t border-white/5 pt-3">
        DSCR computed as NCADS &divide; ADS. NCADS from latest extracted year (
        {latestYear ?? "\u2014"}). ADS uses standard amortization formula; IO
        period blended for first-year estimate. Changes here are not saved
        &mdash; use Pricing tab to persist assumptions.
      </div>
    </div>
  );
}
