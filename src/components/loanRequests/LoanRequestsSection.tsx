"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  LoanRequest,
  LoanRequestInput,
  ProductType,
  ProductTypeConfig,
  ProductCategory,
  LoanRequestStatus,
  PropertyAddress,
  RateIndex,
} from "@/lib/loanRequests/types";
import {
  getProductShape,
  type ProductShapeConfig,
} from "@/lib/loanRequests/productShapeConfig";
import { invalidateJourneyState } from "@/hooks/useJourneyState";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "\u2014";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

const STATUS_COLORS: Record<LoanRequestStatus, string> = {
  draft: "bg-white/10 text-white/70",
  submitted: "bg-blue-500/15 text-blue-300",
  under_review: "bg-yellow-500/15 text-yellow-300",
  pricing_requested: "bg-purple-500/15 text-purple-300",
  terms_proposed: "bg-indigo-500/15 text-indigo-300",
  terms_accepted: "bg-green-500/15 text-green-300",
  approved: "bg-green-500/20 text-green-200",
  declined: "bg-red-500/15 text-red-300",
  withdrawn: "bg-white/10 text-white/50",
  funded: "bg-emerald-500/20 text-emerald-200",
};

function statusLabel(s: LoanRequestStatus): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const CATEGORY_LABELS: Record<ProductCategory, string> = {
  REAL_ESTATE: "Real Estate",
  LINES_OF_CREDIT: "Lines of Credit",
  TERM_LOANS: "Term Loans",
  SBA: "SBA",
  SPECIALTY: "Specialty",
};

function fmtAddress(addr: PropertyAddress | null | undefined): string | null {
  if (!addr) return null;
  const parts = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean);
  if (!parts.length) return null;
  let line = addr.street ?? "";
  if (addr.city) line += (line ? ", " : "") + addr.city;
  if (addr.state) line += (line ? ", " : "") + addr.state;
  if (addr.zip) line += (line ? " " : "") + addr.zip;
  if (addr.county) line += ` (${addr.county} County)`;
  return line || null;
}

const RATE_INDEX_LABELS: Record<RateIndex, string> = {
  SOFR: "SOFR",
  UST_5Y: "5Y Treasury",
  PRIME: "Prime",
};

// ---------------------------------------------------------------------------
// Live rates type
// ---------------------------------------------------------------------------

type IndexRateValue = { ratePct: number; asOf: string };
type LiveRates = Record<RateIndex, IndexRateValue> | null;

// ---------------------------------------------------------------------------
// LoanRequestCard
// ---------------------------------------------------------------------------

function LoanRequestCard({
  lr,
  productTypes,
  onEdit,
  onDelete,
  onSubmit,
}: {
  lr: LoanRequest;
  productTypes: ProductTypeConfig[];
  onEdit: () => void;
  onDelete: () => void;
  onSubmit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ptConfig = productTypes.find((p) => p.code === lr.product_type);
  const label = ptConfig?.label ?? lr.product_type;
  const category = ptConfig?.category
    ? CATEGORY_LABELS[ptConfig.category as ProductCategory] ?? ptConfig.category
    : null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{label}</span>
            {category && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">
                {category}
              </span>
            )}
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[lr.status] ?? "bg-white/10 text-white/60"}`}
            >
              {statusLabel(lr.status)}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-3 text-xs text-white/50">
            {lr.requested_amount != null && (
              <span>{fmtCurrency(lr.requested_amount)}</span>
            )}
            {lr.requested_term_months != null && (
              <span>{lr.requested_term_months} mo term</span>
            )}
            {lr.rate_type_preference && (
              <span>{lr.rate_type_preference}</span>
            )}
            {lr.requested_rate_index && (
              <span>
                {RATE_INDEX_LABELS[lr.requested_rate_index as RateIndex] ?? lr.requested_rate_index}
                {lr.requested_spread_bps != null && ` +${lr.requested_spread_bps}bps`}
              </span>
            )}
          </div>

          {(lr.loan_purpose || lr.purpose) && (
            <div className="mt-1 text-xs text-white/60 line-clamp-2">
              {lr.loan_purpose || lr.purpose}
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-1">
          {lr.status === "draft" && (
            <button
              onClick={onSubmit}
              className="rounded-md border border-blue-200 bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              Submit
            </button>
          )}
          <button
            onClick={onEdit}
            className="rounded-md border px-2 py-1 text-xs font-medium text-white/60 hover:bg-white/10"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10"
          >
            Delete
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-md border px-2 py-1 text-xs font-medium text-white/40 hover:bg-white/10"
          >
            {expanded ? "Less" : "More"}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-xs text-white/60">
          {lr.requested_amort_months != null && (
            <div>Amortization: {lr.requested_amort_months} months</div>
          )}
          {lr.requested_interest_only_months != null && (
            <div>Interest-Only: {lr.requested_interest_only_months} months</div>
          )}
          {lr.property_type && <div>Property Type: {lr.property_type}</div>}
          {lr.occupancy_type && <div>Occupancy: {lr.occupancy_type.replace(/_/g, " ")}</div>}
          {lr.property_value != null && (
            <div>Property Value: {fmtCurrency(lr.property_value)}</div>
          )}
          {lr.purchase_price != null && (
            <div>Purchase Price: {fmtCurrency(lr.purchase_price)}</div>
          )}
          {lr.down_payment != null && (
            <div>Down Payment: {fmtCurrency(lr.down_payment)}</div>
          )}
          {lr.property_noi != null && (
            <div>NOI: {fmtCurrency(lr.property_noi)}</div>
          )}
          {fmtAddress(lr.property_address_json) && (
            <div>Property Address: {fmtAddress(lr.property_address_json)}</div>
          )}
          {lr.sba_program && <div>SBA Program: {lr.sba_program}</div>}
          {lr.injection_amount != null && (
            <div>Injection: {fmtCurrency(lr.injection_amount)}</div>
          )}
          {lr.injection_source && (
            <div>Injection Source: {lr.injection_source}</div>
          )}
          {lr.collateral_summary && (
            <div>Collateral: {lr.collateral_summary}</div>
          )}
          {lr.guarantors_summary && (
            <div>Guarantors: {lr.guarantors_summary}</div>
          )}
          {lr.notes && <div className="italic">{lr.notes}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoanRequestForm — Product-shape-aware, with live rates
// ---------------------------------------------------------------------------

type FormState = Partial<LoanRequestInput> & {
  // Extra fields stored via request_details JSONB
  draw_period_months?: number | null;
  review_frequency_months?: number | null;
  equipment_make?: string | null;
  equipment_model?: string | null;
  equipment_year?: number | null;
};

function LoanRequestForm({
  productTypes,
  existingRequest,
  saving,
  liveRates,
  ratesLoading,
  onSave,
  onCancel,
}: {
  productTypes: ProductTypeConfig[];
  existingRequest?: LoanRequest | null;
  saving: boolean;
  liveRates: LiveRates;
  ratesLoading: boolean;
  onSave: (input: LoanRequestInput) => Promise<void>;
  onCancel: () => void;
}) {
  const existingDetails = (existingRequest?.request_details ?? {}) as Record<string, unknown>;

  const [form, setForm] = useState<FormState>(() => ({
    product_type: existingRequest?.product_type ?? ("" as any),
    requested_amount: existingRequest?.requested_amount ?? null,
    loan_purpose: existingRequest?.loan_purpose ?? existingRequest?.purpose ?? null,
    requested_term_months: existingRequest?.requested_term_months ?? null,
    requested_amort_months: existingRequest?.requested_amort_months ?? null,
    rate_type_preference: existingRequest?.rate_type_preference ?? null,
    requested_rate_index: (existingRequest?.requested_rate_index as RateIndex) ?? null,
    requested_spread_bps: existingRequest?.requested_spread_bps ?? null,
    requested_interest_only_months: existingRequest?.requested_interest_only_months ?? null,
    property_type: existingRequest?.property_type ?? null,
    occupancy_type: existingRequest?.occupancy_type ?? null,
    property_value: existingRequest?.property_value ?? null,
    purchase_price: existingRequest?.purchase_price ?? null,
    down_payment: existingRequest?.down_payment ?? null,
    property_noi: existingRequest?.property_noi ?? null,
    property_address_json: existingRequest?.property_address_json ?? null,
    sba_program: existingRequest?.sba_program ?? null,
    injection_amount: existingRequest?.injection_amount ?? null,
    injection_source: existingRequest?.injection_source ?? null,
    collateral_summary: existingRequest?.collateral_summary ?? null,
    guarantors_summary: existingRequest?.guarantors_summary ?? null,
    notes: existingRequest?.notes ?? null,
    // request_details extras
    draw_period_months: (existingDetails.draw_period_months as number) ?? null,
    review_frequency_months: (existingDetails.review_frequency_months as number) ?? null,
    equipment_make: (existingDetails.equipment_make as string) ?? null,
    equipment_model: (existingDetails.equipment_model as string) ?? null,
    equipment_year: (existingDetails.equipment_year as number) ?? null,
  }));

  const [evergreenEnabled, setEvergreenEnabled] = useState(
    existingDetails.has_evergreen_feature === true,
  );

  const [amountRaw, setAmountRaw] = useState(
    existingRequest?.requested_amount?.toString() ?? "",
  );

  // --- Shape derivation ---
  const selectedConfig = productTypes.find((p) => p.code === form.product_type);
  const shape: ProductShapeConfig = getProductShape(
    selectedConfig?.category as ProductCategory | undefined,
    form.product_type as string | undefined,
  );

  const showTermAmort =
    shape.showTerm === "show" ||
    (shape.showEvergreen && evergreenEnabled) ||
    shape.showTerm === "optional";

  // Product-aware placeholders for AR LOC vs generic
  const isArLoc = form.product_type === "ACCOUNTS_RECEIVABLE" || form.product_type === "LOC_SECURED";
  const purposePlaceholder = isArLoc
    ? "e.g. Working capital / AR financing — fund payroll and operations against eligible receivables"
    : "e.g. Purchase building";
  const collateralPlaceholder = isArLoc
    ? "e.g. AR borrowing base — eligible receivables per aging report, blanket UCC lien on business assets"
    : "e.g. First lien on property";

  // Group products by category
  const byCategory = productTypes.reduce(
    (acc, pt) => {
      const cat = pt.category as ProductCategory;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(pt);
      return acc;
    },
    {} as Record<ProductCategory, ProductTypeConfig[]>,
  );

  function trimToNull(s: string | null | undefined): string | null {
    if (s == null) return null;
    const trimmed = s.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function parseNumberOrNull(raw: string | number | null | undefined): number | null {
    if (raw == null || raw === "") return null;
    const cleaned = String(raw).replace(/[,\s$]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isNaN(n) ? null : n;
  }

  function normalizeAddressJson(
    addr: Partial<PropertyAddress> | null | undefined,
  ): PropertyAddress | null {
    if (!addr) return null;
    const norm: PropertyAddress = {};
    if (addr.street?.trim()) norm.street = addr.street.trim();
    if (addr.city?.trim()) norm.city = addr.city.trim();
    if (addr.state?.trim()) norm.state = addr.state.trim();
    if (addr.zip?.trim()) norm.zip = addr.zip.trim();
    if (addr.county?.trim()) norm.county = addr.county.trim();
    return Object.keys(norm).length > 0 ? norm : null;
  }

  function setStr<K extends keyof FormState>(key: K, val: string) {
    setForm((prev) => ({ ...prev, [key]: val || null }));
  }

  function setNum<K extends keyof FormState>(key: K, val: string) {
    setForm((prev) => ({ ...prev, [key]: val === "" ? null : Number(val) }));
  }

  function setAddr(field: keyof PropertyAddress, val: string) {
    setForm((prev) => ({
      ...prev,
      property_address_json: {
        ...prev.property_address_json,
        [field]: val || undefined,
      },
    }));
  }

  function handleProductTypeChange(newCode: string) {
    const newConfig = productTypes.find((p) => p.code === newCode);
    const newShape = getProductShape(
      newConfig?.category as ProductCategory | undefined,
      newCode,
    );
    setForm((prev) => ({
      ...prev,
      product_type: newCode as ProductType,
      // Clear term/amort if new shape hides them
      requested_term_months: newShape.showTerm === "hide" ? null : prev.requested_term_months,
      requested_amort_months: newShape.showAmort === "hide" ? null : prev.requested_amort_months,
      requested_interest_only_months: newShape.showInterestOnly ? prev.requested_interest_only_months : null,
      // Clear RE fields if switching away from RE
      property_type: newShape.showRealEstate ? prev.property_type : null,
      property_value: newShape.showRealEstate ? prev.property_value : null,
      purchase_price: newShape.showRealEstate ? prev.purchase_price : null,
      down_payment: newShape.showRealEstate ? prev.down_payment : null,
      property_noi: newShape.showRealEstate ? prev.property_noi : null,
      property_address_json: newShape.showRealEstate ? prev.property_address_json : null,
      // AR LOC defaults: pre-fill draw period and review frequency
      draw_period_months: newCode === "ACCOUNTS_RECEIVABLE" || newCode === "LOC_SECURED"
        ? (prev.draw_period_months ?? 12)
        : prev.draw_period_months,
      review_frequency_months: newCode === "ACCOUNTS_RECEIVABLE" || newCode === "LOC_SECURED"
        ? (prev.review_frequency_months ?? 12)
        : prev.review_frequency_months,
      // Clear SBA if switching away
      sba_program: newShape.showSba ? prev.sba_program : null,
      injection_amount: newShape.showSba ? prev.injection_amount : null,
      injection_source: newShape.showSba ? prev.injection_source : null,
      // Clear spread if SBA (formula-driven)
      requested_spread_bps: newShape.showSpread ? prev.requested_spread_bps : null,
    }));
    setEvergreenEnabled(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.product_type) return;

    // Build request_details JSONB
    const requestDetails: Record<string, unknown> = {
      ...(existingDetails ?? {}),
    };
    if (shape.showEvergreen) {
      requestDetails.has_evergreen_feature = evergreenEnabled;
      if (evergreenEnabled) {
        requestDetails.evergreen_term_months = parseNumberOrNull(form.requested_term_months);
      }
    }
    if (shape.showLineDetails) {
      requestDetails.draw_period_months = form.draw_period_months ?? null;
      requestDetails.review_frequency_months = form.review_frequency_months ?? null;
    }
    if (shape.showEquipmentDetails) {
      requestDetails.equipment_make = trimToNull(form.equipment_make);
      requestDetails.equipment_model = trimToNull(form.equipment_model);
      requestDetails.equipment_year = form.equipment_year ?? null;
    }

    const input: LoanRequestInput = {
      product_type: form.product_type as ProductType,
      requested_amount: parseNumberOrNull(amountRaw),
      loan_purpose: trimToNull(form.loan_purpose),
      requested_term_months: showTermAmort ? parseNumberOrNull(form.requested_term_months) : null,
      requested_amort_months: showTermAmort ? parseNumberOrNull(form.requested_amort_months) : null,
      rate_type_preference: form.rate_type_preference ?? null,
      requested_rate_index: form.requested_rate_index ?? null,
      requested_spread_bps: shape.showSpread ? (form.requested_spread_bps ?? null) : null,
      requested_interest_only_months: shape.showInterestOnly
        ? parseNumberOrNull(form.requested_interest_only_months)
        : null,
      request_details: requestDetails,
      property_type: trimToNull(form.property_type),
      occupancy_type: form.occupancy_type ?? null,
      property_value: parseNumberOrNull(form.property_value),
      purchase_price: parseNumberOrNull(form.purchase_price),
      down_payment: parseNumberOrNull(form.down_payment),
      property_noi: parseNumberOrNull(form.property_noi),
      property_address_json: normalizeAddressJson(form.property_address_json),
      sba_program: form.sba_program ?? null,
      injection_amount: parseNumberOrNull(form.injection_amount),
      injection_source: trimToNull(form.injection_source),
      collateral_summary: trimToNull(form.collateral_summary),
      guarantors_summary: trimToNull(form.guarantors_summary),
      notes: trimToNull(form.notes),
    };

    await onSave(input);
  }

  const inputCls =
    "mt-1 h-9 w-full rounded-md border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400";

  // Native <select> dropdowns need explicit dark background + light text on
  // both the trigger and the OS-rendered option list. color-scheme:dark tells
  // the browser to use dark chrome for the dropdown popup.
  const selectCls =
    "mt-1 h-9 w-full rounded-md border border-white/15 bg-[#1a1d23] px-3 text-sm text-white focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 [color-scheme:dark]";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-4"
    >
      <div className="text-sm font-semibold text-white/90">
        {existingRequest ? "Edit Loan Request" : "New Loan Request"}
      </div>

      {/* Product type */}
      <div>
        <label className="text-xs font-medium text-white/60">
          Product Type *
        </label>
        <select
          className={selectCls}
          value={form.product_type ?? ""}
          onChange={(e) => handleProductTypeChange(e.target.value)}
          required
          disabled={saving}
        >
          <option value="">Select product...</option>
          {Object.entries(byCategory).map(([cat, items]) => (
            <optgroup key={cat} label={CATEGORY_LABELS[cat as ProductCategory] ?? cat}>
              {items.map((pt) => (
                <option key={pt.code} value={pt.code}>
                  {pt.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Amount & Purpose */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-white/60">
            Requested Amount
          </label>
          <input
            className={inputCls}
            type="text"
            inputMode="decimal"
            placeholder="e.g. 750,000"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            disabled={saving}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-white/60">Purpose</label>
          <textarea
            className={inputCls + " h-auto py-2 resize-none"}
            rows={2}
            placeholder={purposePlaceholder}
            value={form.loan_purpose ?? ""}
            onChange={(e) => setStr("loan_purpose", e.target.value)}
            disabled={saving}
          />
        </div>
      </div>

      {/* Term / Amort — conditional on shape (non-LOC products) */}
      {showTermAmort && !shape.showLineDetails && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs font-medium text-white/60">
              Term (months)
              {shape.showTerm === "optional" && (
                <span className="ml-1 text-white/40">(optional)</span>
              )}
            </label>
            <input
              className={inputCls}
              type="number"
              placeholder="e.g. 120"
              value={form.requested_term_months ?? ""}
              onChange={(e) => setNum("requested_term_months", e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-white/60">
              Amort (months)
              {shape.showAmort === "optional" && (
                <span className="ml-1 text-white/40">(optional)</span>
              )}
            </label>
            <input
              className={inputCls}
              type="number"
              placeholder="e.g. 300"
              value={form.requested_amort_months ?? ""}
              onChange={(e) => setNum("requested_amort_months", e.target.value)}
              disabled={saving}
            />
          </div>
          {/* Rate preference in same row */}
          {shape.showRatePreference && (
            <div>
              <label className="text-xs font-medium text-white/60">
                Rate Preference
              </label>
              <select
                className={selectCls}
                value={form.rate_type_preference ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, rate_type_preference: (e.target.value || null) as any }))}
                disabled={saving}
              >
                <option value="">No preference</option>
                <option value="FIXED">Fixed</option>
                <option value="VARIABLE">Variable</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Rate preference standalone for LOC / line products */}
      {shape.showRatePreference && (shape.showLineDetails || (!showTermAmort && !shape.showLineDetails)) && (
        <div className="max-w-xs">
          <label className="text-xs font-medium text-white/60">
            Rate Preference
          </label>
          <select
            className={selectCls}
            value={form.rate_type_preference ?? ""}
            onChange={(e) => setForm((prev) => ({ ...prev, rate_type_preference: (e.target.value || null) as any }))}
            disabled={saving}
          >
            <option value="">No preference</option>
            <option value="FIXED">Fixed</option>
            <option value="VARIABLE">Variable</option>
          </select>
        </div>
      )}

      {/* Interest-Only period */}
      {shape.showInterestOnly && (
        <div className="max-w-xs">
          <label className="text-xs font-medium text-white/60">
            Interest-Only Period (months)
          </label>
          <input
            className={inputCls}
            type="number"
            placeholder="e.g. 24"
            value={form.requested_interest_only_months ?? ""}
            onChange={(e) => setNum("requested_interest_only_months", e.target.value)}
            disabled={saving}
          />
        </div>
      )}

      {/* Rate index chips + spread */}
      {shape.showRateIndex && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-white/60">
              Rate Index
              {ratesLoading && (
                <span className="ml-2 text-[10px] text-white/40">fetching rates…</span>
              )}
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              {(["SOFR", "UST_5Y", "PRIME"] as const).map((code) => {
                const rate = liveRates?.[code];
                const selected = form.requested_rate_index === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        requested_rate_index: selected ? null : code,
                      }))
                    }
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? "border-blue-500 bg-blue-500/15 text-blue-300"
                        : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                    disabled={saving}
                  >
                    <span className="font-semibold">{RATE_INDEX_LABELS[code]}</span>
                    {rate ? (
                      <span className="ml-1.5 text-[10px] text-white/40">
                        {rate.ratePct.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="ml-1.5 text-[10px] text-white/30">&mdash;</span>
                    )}
                  </button>
                );
              })}
            </div>
            {liveRates && form.requested_rate_index && liveRates[form.requested_rate_index] && (
              <p className="mt-1 text-[10px] text-white/40">
                as of {liveRates[form.requested_rate_index]!.asOf}
              </p>
            )}
          </div>

          {/* Spread + estimated all-in */}
          {shape.showSpread && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-white/60">
                  Spread (bps)
                </label>
                <input
                  className={inputCls}
                  type="number"
                  step="25"
                  placeholder="e.g. 300"
                  value={form.requested_spread_bps ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      requested_spread_bps: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  disabled={saving}
                />
              </div>
              {form.requested_rate_index && form.requested_spread_bps != null && liveRates?.[form.requested_rate_index] && (() => {
                const base = liveRates[form.requested_rate_index!]!.ratePct;
                const allIn = base + form.requested_spread_bps / 100;
                return (
                  <div className="flex flex-col justify-end">
                    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                      <div className="text-[10px] text-white/40 uppercase tracking-wide">Est. All-In Rate</div>
                      <div className="text-lg font-bold text-white">{allIn.toFixed(2)}%</div>
                      <div className="text-[10px] text-white/40">
                        {base.toFixed(2)}% + {form.requested_spread_bps}bps
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* LOC-specific section */}
      {shape.showLineDetails && (
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 space-y-3">
          <div className="text-xs font-semibold text-white/70">Line of Credit Details</div>

          {shape.showEvergreen && (
            <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={evergreenEnabled}
                onChange={(e) => setEvergreenEnabled(e.target.checked)}
                disabled={saving}
                className="rounded border-white/20"
              />
              This line has a term-out / evergreen feature
            </label>
          )}

          {evergreenEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-white/60">
                  Term-Out Period (months)
                </label>
                <input
                  className={inputCls}
                  type="number"
                  placeholder="e.g. 12"
                  value={form.requested_term_months ?? ""}
                  onChange={(e) => setNum("requested_term_months", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-white/60">
                  Amortization (months)
                </label>
                <input
                  className={inputCls}
                  type="number"
                  placeholder="e.g. 60"
                  value={form.requested_amort_months ?? ""}
                  onChange={(e) => setNum("requested_amort_months", e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-white/60">
                Draw Period (months)
              </label>
              <input
                className={inputCls}
                type="number"
                placeholder="e.g. 12"
                value={form.draw_period_months ?? ""}
                onChange={(e) => setNum("draw_period_months", e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/60">
                Annual Review Frequency
              </label>
              <select
                className={selectCls}
                value={form.review_frequency_months ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    review_frequency_months: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                disabled={saving}
              >
                <option value="">Select…</option>
                <option value="12">Annual (12 mo)</option>
                <option value="6">Semi-Annual (6 mo)</option>
                <option value="3">Quarterly (3 mo)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Equipment details */}
      {shape.showEquipmentDetails && (
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 space-y-3">
          <div className="text-xs font-semibold text-white/70">Equipment Details</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-white/60">Make</label>
              <input
                className={inputCls}
                placeholder="e.g. Caterpillar"
                value={form.equipment_make ?? ""}
                onChange={(e) => setStr("equipment_make", e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/60">Model</label>
              <input
                className={inputCls}
                placeholder="e.g. 320 Excavator"
                value={form.equipment_model ?? ""}
                onChange={(e) => setStr("equipment_model", e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/60">Year</label>
              <input
                className={inputCls}
                type="number"
                placeholder="e.g. 2023"
                value={form.equipment_year ?? ""}
                onChange={(e) => setNum("equipment_year", e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        </div>
      )}

      {/* Real Estate fields */}
      {shape.showRealEstate && (
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 space-y-3">
          <div className="text-xs font-semibold text-white/70">
            Real Estate Details
          </div>

          {/* LTV computed display */}
          {shape.showLtv && parseNumberOrNull(amountRaw) && form.property_value && (
            <div className="rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs">
              <span className="font-medium text-blue-300">Est. LTV: </span>
              <span className="text-blue-200 font-bold">
                {((parseNumberOrNull(amountRaw)! / (form.property_value as number)) * 100).toFixed(1)}%
              </span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-white/60">
                Property Type
              </label>
              <input
                className={inputCls}
                placeholder="e.g. Office, Retail, Industrial"
                value={form.property_type ?? ""}
                onChange={(e) => setStr("property_type", e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/60">
                Occupancy
              </label>
              <select
                className={selectCls}
                value={form.occupancy_type ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, occupancy_type: (e.target.value || null) as any }))}
                disabled={saving}
              >
                <option value="">Select...</option>
                <option value="OWNER_OCCUPIED">Owner Occupied</option>
                <option value="INVESTOR">Investor</option>
                <option value="MIXED">Mixed</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-white/60">
                Property Value
              </label>
              <input
                className={inputCls}
                type="number"
                placeholder="e.g. 1200000"
                value={form.property_value ?? ""}
                onChange={(e) => setNum("property_value", e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/60">
                Purchase Price
              </label>
              <input
                className={inputCls}
                type="number"
                placeholder="e.g. 1000000"
                value={form.purchase_price ?? ""}
                onChange={(e) => setNum("purchase_price", e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/60">
                Down Payment
              </label>
              <input
                className={inputCls}
                type="number"
                placeholder="e.g. 250000"
                value={form.down_payment ?? ""}
                onChange={(e) => setNum("down_payment", e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/60">
                Property NOI
              </label>
              <input
                className={inputCls}
                type="number"
                placeholder="e.g. 120000"
                value={form.property_noi ?? ""}
                onChange={(e) => setNum("property_noi", e.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          {/* Property Address */}
          <div className="text-xs font-medium text-white/60 mt-2">
            Property Address
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <input
                className={inputCls}
                placeholder="Street address"
                value={form.property_address_json?.street ?? ""}
                onChange={(e) => setAddr("street", e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <input
                className={inputCls}
                placeholder="City"
                value={form.property_address_json?.city ?? ""}
                onChange={(e) => setAddr("city", e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                className={inputCls}
                placeholder="State"
                value={form.property_address_json?.state ?? ""}
                onChange={(e) => setAddr("state", e.target.value)}
                disabled={saving}
              />
              <input
                className={inputCls}
                placeholder="ZIP"
                value={form.property_address_json?.zip ?? ""}
                onChange={(e) => setAddr("zip", e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <input
                className={inputCls}
                placeholder="County"
                value={form.property_address_json?.county ?? ""}
                onChange={(e) => setAddr("county", e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        </div>
      )}

      {/* SBA fields */}
      {shape.showSba && (
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="text-xs font-semibold text-white/70 mb-2">
            SBA Details
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-white/60">
                SBA Program
              </label>
              <select
                className={selectCls}
                value={form.sba_program ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, sba_program: (e.target.value || null) as any }))}
                disabled={saving}
              >
                <option value="">Select...</option>
                <option value="7A">7(a)</option>
                <option value="504">504</option>
                <option value="EXPRESS">Express</option>
                <option value="COMMUNITY_ADVANTAGE">Community Advantage</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-white/60">
                Injection Amount
              </label>
              <input
                className={inputCls}
                type="number"
                placeholder="e.g. 100000"
                value={form.injection_amount ?? ""}
                onChange={(e) => setNum("injection_amount", e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-white/60">
                Injection Source
              </label>
              <input
                className={inputCls}
                placeholder="e.g. Personal savings, 401k rollover"
                value={form.injection_source ?? ""}
                onChange={(e) => setStr("injection_source", e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        </div>
      )}

      {/* Collateral & Guarantors */}
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
        <div className="text-xs font-semibold text-white/70 mb-2">
          Collateral & Guarantors
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-white/60">
              Collateral Summary
            </label>
            <textarea
              className={inputCls + " h-auto py-2 resize-none"}
              rows={2}
              placeholder={collateralPlaceholder}
              value={form.collateral_summary ?? ""}
              onChange={(e) => setStr("collateral_summary", e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-white/60">
              Guarantors Summary
            </label>
            <textarea
              className={inputCls + " h-auto py-2 resize-none"}
              rows={2}
              placeholder="e.g. John Smith (51% owner), Jane Doe (49% owner)"
              value={form.guarantors_summary ?? ""}
              onChange={(e) => setStr("guarantors_summary", e.target.value)}
              disabled={saving}
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs font-medium text-white/60">Notes</label>
        <textarea
          className={inputCls + " h-auto py-2 resize-none"}
          rows={2}
          placeholder="Additional notes or context"
          value={form.notes ?? ""}
          onChange={(e) => setStr("notes", e.target.value)}
          disabled={saving}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !form.product_type}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving
            ? "Saving..."
            : existingRequest
              ? "Update Request"
              : "Add Request"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border px-4 py-2 text-sm font-medium text-white/60 hover:bg-white/10 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// LoanRequestsSection (exported)
// ---------------------------------------------------------------------------

export function LoanRequestsSection({ dealId }: { dealId: string }) {
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [productTypesLoading, setProductTypesLoading] = useState(true);
  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [productTypes, setProductTypes] = useState<ProductTypeConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [productTypesError, setProductTypesError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRequest, setEditingRequest] = useState<LoanRequest | null>(null);
  const [saving, setSaving] = useState(false);

  // Live rates — fetched once on mount, non-blocking
  const [liveRates, setLiveRates] = useState<LiveRates>(null);
  const [ratesLoading, setRatesLoading] = useState(false);

  useEffect(() => {
    setRatesLoading(true);
    fetch("/api/rates/latest", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setLiveRates(j.rates);
      })
      .catch(() => {})
      .finally(() => setRatesLoading(false));
  }, []);

  const loadRequests = useCallback(async () => {
    setError(null);
    setRequestsLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/loan-requests`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok)
        throw new Error(json?.error ?? "Failed to load loan requests");
      setRequests(json.requests ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setRequestsLoading(false);
    }
  }, [dealId]);

  const loadProductTypes = useCallback(async () => {
    setProductTypesError(null);
    setProductTypesLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/loan-product-types", {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok)
        throw new Error(json?.error ?? "Failed to load loan product types");
      setProductTypes(json.productTypes ?? []);
    } catch (e: any) {
      const aborted = e?.name === "AbortError";
      setProductTypesError(
        aborted
          ? "Loan products timed out. Refresh to retry."
          : e?.message ?? "Failed to load loan products",
      );
    } finally {
      clearTimeout(timer);
      setProductTypesLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadRequests(), loadProductTypes()]);
  }, [loadRequests, loadProductTypes]);

  useEffect(() => {
    loadRequests();
    loadProductTypes();
  }, [loadRequests, loadProductTypes]);

  async function handleSave(input: LoanRequestInput) {
    setSaving(true);
    setError(null);
    try {
      const isEdit = !!editingRequest;
      const url = isEdit
        ? `/api/deals/${dealId}/loan-requests/${editingRequest!.id}`
        : `/api/deals/${dealId}/loan-requests`;
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Save failed");

      setShowForm(false);
      setEditingRequest(null);
      await load();
      // SPEC-LOAN-REQUEST-JOURNEY-RAIL-STALE-CTA-FIX-1: a created/updated request can change lifecycle
      // blockers — signal the Journey Rail to refetch now instead of waiting for its 30s poll.
      invalidateJourneyState(dealId);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(requestId: string) {
    if (!confirm("Delete this loan request?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/loan-requests/${requestId}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Delete failed");
      await load();
      // Deleting the last request may legitimately restore the "Add Loan Request" CTA — refresh the rail.
      invalidateJourneyState(dealId);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitRequest(requestId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/loan-requests/${requestId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "submitted" }),
        },
      );
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Submit failed");
      await load();
      // Submitting a request clears loan_request_missing — refresh the rail immediately.
      invalidateJourneyState(dealId);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  if (requestsLoading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Loading loan requests...
      </div>
    );
  }

  const productTypesReady = !productTypesLoading && productTypes.length > 0;
  const productTypesEmpty = !productTypesLoading && productTypes.length === 0 && !productTypesError;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">
            Loan Requests
          </div>
          <div className="text-xs text-white/50">
            What the borrower is asking for
          </div>
        </div>
        {!showForm && !editingRequest && (
          <button
            onClick={() => {
              setEditingRequest(null);
              setShowForm(true);
            }}
            disabled={saving || productTypesLoading || !productTypesReady}
            title={
              productTypesLoading
                ? "Loading loan products..."
                : !productTypesReady
                  ? "Loan products unavailable — refresh to retry"
                  : undefined
            }
            className="rounded-md border px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 disabled:opacity-50"
          >
            + Add Request
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/*
        SPEC-BUDDY-HARD-STOP-AUDIT-AND-RECOVERY-1 #2: product catalog
        unavailable must never silently disable Add Request. Surface
        the reason inline with an explicit Retry button + admin link
        instead of relying on a tooltip below the disabled button.
      */}
      {productTypesError && (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-300"
          role="alert"
          data-testid="loan-products-error"
        >
          <span>{productTypesError}</span>
          <button
            type="button"
            onClick={() => loadProductTypes()}
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
          >
            Retry
          </button>
        </div>
      )}

      {productTypesEmpty && (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-300"
          role="alert"
          data-testid="loan-products-empty"
        >
          <span>
            No loan products configured for this bank. An administrator must enable at least one product before loan requests can be added.
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadProductTypes()}
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
            >
              Retry
            </button>
            <a
              href="/admin/loan-products"
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
            >
              Configure Loan Products
            </a>
          </span>
        </div>
      )}

      {requests.length === 0 && !showForm && !editingRequest && (
        <div className="mt-4 rounded-lg border-2 border-dashed border-white/15 p-6 text-center">
          <div className="text-sm font-medium text-white/60">
            No loan requests yet
          </div>
          <div className="mt-1 text-xs text-white/40">
            Add at least one loan request to capture what the borrower needs.
          </div>
          <button
            onClick={() => setShowForm(true)}
            disabled={productTypesLoading || !productTypesReady}
            title={
              productTypesLoading
                ? "Loading loan products..."
                : !productTypesReady
                  ? "Loan products unavailable — refresh to retry"
                  : undefined
            }
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {productTypesLoading ? "Loading products..." : "Add Loan Request"}
          </button>
        </div>
      )}

      {requests.length > 0 && (
        <div className="mt-3 space-y-2">
          {requests.map((lr) => (
            <LoanRequestCard
              key={lr.id}
              lr={lr}
              productTypes={productTypes}
              onEdit={() => {
                setEditingRequest(lr);
                setShowForm(false);
              }}
              onDelete={() => handleDelete(lr.id)}
              onSubmit={() => handleSubmitRequest(lr.id)}
            />
          ))}
        </div>
      )}

      {(showForm || editingRequest) && (
        <div className="mt-3">
          <LoanRequestForm
            productTypes={productTypes}
            existingRequest={editingRequest}
            saving={saving}
            liveRates={liveRates}
            ratesLoading={ratesLoading}
            onSave={handleSave}
            onCancel={() => {
              setShowForm(false);
              setEditingRequest(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
