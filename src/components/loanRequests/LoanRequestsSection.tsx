"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  LoanRequest,
  LoanRequestInput,
  ProductType,
  ProductTypeConfig,
  ProductCategory,
  LoanRequestStatus,
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

// ---------------------------------------------------------------------------
// LoanRequestCard
// ---------------------------------------------------------------------------

function LoanRequestCard({
  lr,
  productTypes,
  onEdit,
  onDelete,
}: {
  lr: LoanRequest;
  productTypes: ProductTypeConfig[];
  onEdit: () => void;
  onDelete: () => void;
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
          {lr.property_noi != null && (
            <div>NOI: {fmtCurrency(lr.property_noi)}</div>
          )}
          {lr.sba_program && <div>SBA Program: {lr.sba_program}</div>}
          {lr.injection_amount != null && (
            <div>Injection: {fmtCurrency(lr.injection_amount)}</div>
          )}
          {lr.notes && <div className="italic">{lr.notes}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoanRequestForm
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
  const [productType, setProductType] = useState<ProductType | "">(
    existingRequest?.product_type ?? "",
  );
  const [amount, setAmount] = useState(
    existingRequest?.requested_amount?.toString() ?? "",
  );
  const [purpose, setPurpose] = useState(
    existingRequest?.loan_purpose ?? existingRequest?.purpose ?? "",
  );
  const [termMonths, setTermMonths] = useState(
    existingRequest?.requested_term_months?.toString() ?? "",
  );
  const [amortMonths, setAmortMonths] = useState(
    existingRequest?.requested_amort_months?.toString() ?? "",
  );
  const [ratePreference, setRatePreference] = useState(
    existingRequest?.rate_type_preference ?? "",
  );
  // RE fields
  const [propertyType, setPropertyType] = useState(
    existingRequest?.property_type ?? "",
  );
  const [occupancyType, setOccupancyType] = useState(
    existingRequest?.occupancy_type ?? "",
  );
  const [propertyValue, setPropertyValue] = useState(
    existingRequest?.property_value?.toString() ?? "",
  );
  const [purchasePrice, setPurchasePrice] = useState(
    existingRequest?.purchase_price?.toString() ?? "",
  );
  // SBA fields
  const [sbaProgram, setSbaProgram] = useState(
    existingRequest?.sba_program ?? "",
  );
  const [injectionAmount, setInjectionAmount] = useState(
    existingRequest?.injection_amount?.toString() ?? "",
  );

  const selectedConfig = productTypes.find((p) => p.code === productType);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productType) return;

    const input: LoanRequestInput = {
      product_type: productType as ProductType,
      requested_amount: parseNumeric(amount),
      loan_purpose: purpose || null,
      requested_term_months: termMonths ? Number(termMonths) : null,
      requested_amort_months: amortMonths ? Number(amortMonths) : null,
      rate_type_preference: (ratePreference || null) as any,
      property_type: propertyType || null,
      occupancy_type: (occupancyType || null) as any,
      property_value: propertyValue ? Number(propertyValue) : null,
      purchase_price: purchasePrice ? Number(purchasePrice) : null,
      sba_program: (sbaProgram || null) as any,
      injection_amount: injectionAmount ? Number(injectionAmount) : null,
    };

    await onSave(input);
  }

  const inputCls =
    "mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400";

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
          value={productType}
          onChange={(e) => setProductType(e.target.value as ProductType)}
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
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={saving}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Purpose</label>
          <textarea
            className={inputCls + " h-auto py-2 resize-none"}
            rows={2}
            placeholder="e.g. Purchase building"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
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
            value={termMonths}
            onChange={(e) => setTermMonths(e.target.value)}
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
            value={amortMonths}
            onChange={(e) => setAmortMonths(e.target.value)}
            disabled={saving}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">
            Rate Preference
          </label>
          <select
            className={inputCls}
            value={ratePreference}
            onChange={(e) => setRatePreference(e.target.value)}
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
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-700 mb-2">
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
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">
                Occupancy
              </label>
              <select
                className={inputCls}
                value={occupancyType}
                onChange={(e) => setOccupancyType(e.target.value)}
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
                value={propertyValue}
                onChange={(e) => setPropertyValue(e.target.value)}
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
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
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
                value={sbaProgram}
                onChange={(e) => setSbaProgram(e.target.value)}
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
                value={injectionAmount}
                onChange={(e) => setInjectionAmount(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !productType}
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
