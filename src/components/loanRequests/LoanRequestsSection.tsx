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
} from "@/lib/loanRequests/types";

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
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-800",
  pricing_requested: "bg-purple-100 text-purple-700",
  terms_proposed: "bg-indigo-100 text-indigo-700",
  terms_accepted: "bg-green-100 text-green-700",
  approved: "bg-green-200 text-green-800",
  declined: "bg-red-100 text-red-700",
  withdrawn: "bg-slate-200 text-slate-600",
  funded: "bg-emerald-200 text-emerald-800",
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
  // "123 Main St, Denver, CO 80202"
  let line = addr.street ?? "";
  if (addr.city) line += (line ? ", " : "") + addr.city;
  if (addr.state) line += (line ? ", " : "") + addr.state;
  if (addr.zip) line += (line ? " " : "") + addr.zip;
  if (addr.county) line += ` (${addr.county} County)`;
  return line || null;
}

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
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">{label}</span>
            {category && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {category}
              </span>
            )}
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[lr.status] ?? "bg-slate-100 text-slate-600"}`}
            >
              {statusLabel(lr.status)}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
            {lr.requested_amount != null && (
              <span>{fmtCurrency(lr.requested_amount)}</span>
            )}
            {lr.requested_term_months != null && (
              <span>{lr.requested_term_months} mo term</span>
            )}
            {lr.rate_type_preference && (
              <span>{lr.rate_type_preference}</span>
            )}
          </div>

          {(lr.loan_purpose || lr.purpose) && (
            <div className="mt-1 text-xs text-slate-600 line-clamp-2">
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
            className="rounded-md border px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-md border px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-50"
          >
            {expanded ? "Less" : "More"}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
          {lr.requested_amort_months != null && (
            <div>Amortization: {lr.requested_amort_months} months</div>
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
// LoanRequestForm — Canonical structured state mirroring LoanRequestInput
// ---------------------------------------------------------------------------

function LoanRequestForm({
  productTypes,
  existingRequest,
  saving,
  onSave,
  onCancel,
}: {
  productTypes: ProductTypeConfig[];
  existingRequest?: LoanRequest | null;
  saving: boolean;
  onSave: (input: LoanRequestInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<LoanRequestInput>>(() => ({
    product_type: existingRequest?.product_type ?? ("" as any),
    requested_amount: existingRequest?.requested_amount ?? null,
    loan_purpose: existingRequest?.loan_purpose ?? existingRequest?.purpose ?? null,
    requested_term_months: existingRequest?.requested_term_months ?? null,
    requested_amort_months: existingRequest?.requested_amort_months ?? null,
    rate_type_preference: existingRequest?.rate_type_preference ?? null,
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
  }));

  // Separate string state for amount field (accepts comma-formatted input)
  const [amountRaw, setAmountRaw] = useState(
    existingRequest?.requested_amount?.toString() ?? "",
  );

  const selectedConfig = productTypes.find((p) => p.code === form.product_type);
  const showRE = selectedConfig?.requires_real_estate ?? false;
  const showSBA = selectedConfig?.requires_sba_fields ?? false;

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

  function parseNumeric(raw: string): number | null {
    const cleaned = raw.replace(/[,\s$]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isNaN(n) ? null : n;
  }

  function setStr<K extends keyof LoanRequestInput>(key: K, val: string) {
    setForm((prev) => ({ ...prev, [key]: val || null }));
  }

  function setNum<K extends keyof LoanRequestInput>(key: K, val: string) {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.product_type) return;

    const addr = form.property_address_json;
    const hasAddr = addr && Object.values(addr).some(Boolean);

    const input: LoanRequestInput = {
      product_type: form.product_type as ProductType,
      requested_amount: parseNumeric(amountRaw),
      loan_purpose: form.loan_purpose || null,
      requested_term_months: form.requested_term_months ?? null,
      requested_amort_months: form.requested_amort_months ?? null,
      rate_type_preference: form.rate_type_preference ?? null,
      property_type: form.property_type || null,
      occupancy_type: form.occupancy_type ?? null,
      property_value: form.property_value ?? null,
      purchase_price: form.purchase_price ?? null,
      down_payment: form.down_payment ?? null,
      property_noi: form.property_noi ?? null,
      property_address_json: hasAddr ? addr : null,
      sba_program: form.sba_program ?? null,
      injection_amount: form.injection_amount ?? null,
      injection_source: form.injection_source || null,
      collateral_summary: form.collateral_summary || null,
      guarantors_summary: form.guarantors_summary || null,
      notes: form.notes || null,
    };

    await onSave(input);
  }

  const inputCls =
    "mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-blue-200 bg-blue-50/30 p-4 space-y-4"
    >
      <div className="text-sm font-semibold text-slate-800">
        {existingRequest ? "Edit Loan Request" : "New Loan Request"}
      </div>

      {/* Product type */}
      <div>
        <label className="text-xs font-medium text-slate-600">
          Product Type *
        </label>
        <select
          className={inputCls}
          value={form.product_type ?? ""}
          onChange={(e) => setForm((prev) => ({ ...prev, product_type: e.target.value as ProductType }))}
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
          <label className="text-xs font-medium text-slate-600">
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
          <label className="text-xs font-medium text-slate-600">Purpose</label>
          <textarea
            className={inputCls + " h-auto py-2 resize-none"}
            rows={2}
            placeholder="e.g. Purchase building"
            value={form.loan_purpose ?? ""}
            onChange={(e) => setStr("loan_purpose", e.target.value)}
            disabled={saving}
          />
        </div>
      </div>

      {/* Term preferences */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium text-slate-600">
            Term (months)
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
          <label className="text-xs font-medium text-slate-600">
            Amort (months)
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
        <div>
          <label className="text-xs font-medium text-slate-600">
            Rate Preference
          </label>
          <select
            className={inputCls}
            value={form.rate_type_preference ?? ""}
            onChange={(e) => setForm((prev) => ({ ...prev, rate_type_preference: (e.target.value || null) as any }))}
            disabled={saving}
          >
            <option value="">No preference</option>
            <option value="FIXED">Fixed</option>
            <option value="VARIABLE">Variable</option>
            <option value="NO_PREFERENCE">No Preference</option>
          </select>
        </div>
      </div>

      {/* Real Estate fields */}
      {showRE && (
        <div className="rounded-md border border-slate-200 bg-white p-3 space-y-3">
          <div className="text-xs font-semibold text-slate-700">
            Real Estate Details
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-600">
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
              <label className="text-xs font-medium text-slate-600">
                Occupancy
              </label>
              <select
                className={inputCls}
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
              <label className="text-xs font-medium text-slate-600">
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
              <label className="text-xs font-medium text-slate-600">
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
              <label className="text-xs font-medium text-slate-600">
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
              <label className="text-xs font-medium text-slate-600">
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
          <div className="text-xs font-medium text-slate-600 mt-2">
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
      {showSBA && (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-700 mb-2">
            SBA Details
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-600">
                SBA Program
              </label>
              <select
                className={inputCls}
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
              <label className="text-xs font-medium text-slate-600">
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
              <label className="text-xs font-medium text-slate-600">
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
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="text-xs font-semibold text-slate-700 mb-2">
          Collateral & Guarantors
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-slate-600">
              Collateral Summary
            </label>
            <textarea
              className={inputCls + " h-auto py-2 resize-none"}
              rows={2}
              placeholder="e.g. Commercial building at 123 Main St, valued at $1.2M"
              value={form.collateral_summary ?? ""}
              onChange={(e) => setStr("collateral_summary", e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">
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
        <label className="text-xs font-medium text-slate-600">Notes</label>
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
          className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
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
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [productTypes, setProductTypes] = useState<ProductTypeConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRequest, setEditingRequest] = useState<LoanRequest | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [reqRes, ptRes] = await Promise.all([
        fetch(`/api/deals/${dealId}/loan-requests`, { cache: "no-store" }),
        fetch("/api/loan-product-types", { cache: "no-store" }),
      ]);
      const reqJson = await reqRes.json();
      const ptJson = await ptRes.json();
      if (!reqJson?.ok)
        throw new Error(reqJson?.error ?? "Failed to load loan requests");
      setRequests(reqJson.requests ?? []);
      setProductTypes(ptJson.productTypes ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

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
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-4 text-sm text-slate-500">
        Loading loan requests...
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            Loan Requests
          </div>
          <div className="text-xs text-slate-500">
            What the borrower is asking for
          </div>
        </div>
        {!showForm && !editingRequest && productTypes.length > 0 && (
          <button
            onClick={() => {
              setEditingRequest(null);
              setShowForm(true);
            }}
            disabled={saving}
            className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            + Add Request
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* No products configured */}
      {productTypes.length === 0 && !loading && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          No loan products configured for this bank. Contact an administrator to set up available loan products.
        </div>
      )}

      {/* Empty state */}
      {requests.length === 0 && !showForm && !editingRequest && productTypes.length > 0 && (
        <div className="mt-4 rounded-lg border-2 border-dashed border-slate-200 p-6 text-center">
          <div className="text-sm font-medium text-slate-600">
            No loan requests yet
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Add at least one loan request to capture what the borrower needs.
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Loan Request
          </button>
        </div>
      )}

      {/* Request cards */}
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

      {/* Form (create or edit) */}
      {(showForm || editingRequest) && (
        <div className="mt-3">
          <LoanRequestForm
            productTypes={productTypes}
            existingRequest={editingRequest}
            saving={saving}
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
