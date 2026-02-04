"use client";

import React, { useState, useMemo } from "react";

type ProductTypeConfig = {
  code: string;
  label: string;
  category: string;
  requires_real_estate: boolean;
  requires_sba_fields: boolean;
};

type Props = {
  token: string;
  dealId: string;
  productTypes: ProductTypeConfig[];
};

const CATEGORY_LABELS: Record<string, string> = {
  REAL_ESTATE: "Real Estate",
  LINES_OF_CREDIT: "Lines of Credit",
  TERM_LOANS: "Term Loans",
  SBA: "SBA Loans",
  SPECIALTY: "Specialty",
};

function parseNumeric(raw: string): number | null {
  const cleaned = raw.replace(/[,\s$]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

export function PortalLoanRequestForm({
  token,
  dealId,
  productTypes,
}: Props) {
  const [productType, setProductType] = useState("");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [loanPurpose, setLoanPurpose] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [sbaProgram, setSbaProgram] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map: Record<string, ProductTypeConfig[]> = {};
    for (const pt of productTypes) {
      const cat = pt.category || "OTHER";
      if (!map[cat]) map[cat] = [];
      map[cat].push(pt);
    }
    return map;
  }, [productTypes]);

  const selectedConfig = productTypes.find((pt) => pt.code === productType);
  const showRealEstate = selectedConfig?.requires_real_estate ?? false;
  const showSba = selectedConfig?.requires_sba_fields ?? false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productType) return;

    const parsedAmount = parseNumeric(requestedAmount);
    if (parsedAmount === null || parsedAmount <= 0) {
      setError("Please enter a valid requested amount.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        product_type: productType,
        requested_amount: parsedAmount,
        loan_purpose: loanPurpose || null,
        requested_term_months: termMonths ? Number(termMonths) : null,
      };

      if (showRealEstate) {
        body.property_type = propertyType || null;
        body.property_value = propertyValue ? parseNumeric(propertyValue) : null;
        body.purchase_price = purchasePrice ? parseNumeric(purchasePrice) : null;
      }

      if (showSba) {
        body.sba_program = sbaProgram || null;
      }

      const res = await fetch(`/api/portal/${token}/loan-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to submit loan request");
      }

      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center">
        <div className="text-lg font-semibold text-white">
          Loan Request Submitted
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          Your loan request has been submitted to the bank for review.
          You will be contacted with next steps.
        </p>
        <button
          className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-200"
          onClick={() => {
            setSubmitted(false);
            setProductType("");
            setRequestedAmount("");
            setLoanPurpose("");
            setTermMonths("");
            setPropertyType("");
            setPropertyValue("");
            setPurchasePrice("");
            setSbaProgram("");
          }}
        >
          Submit Another Request
        </button>
      </div>
    );
  }

  if (productTypes.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center">
        <div className="text-sm font-medium text-neutral-400">
          No loan products are currently available. Please contact the bank for assistance.
        </div>
      </div>
    );
  }

  const inputCls =
    "mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-white focus:outline-none";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Product Type Selection */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <label className="block text-sm font-medium text-neutral-300">
          Loan Product Type <span className="text-red-400">*</span>
        </label>
        <select
          className={inputCls}
          value={productType}
          onChange={(e) => setProductType(e.target.value)}
          required
        >
          <option value="">Select a product type...</option>
          {Object.entries(grouped).map(([category, types]) => (
            <optgroup
              key={category}
              label={CATEGORY_LABELS[category] ?? category}
            >
              {types.map((pt) => (
                <option key={pt.code} value={pt.code}>
                  {pt.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Amount & Purpose */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300">
            Requested Loan Amount <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            className={inputCls}
            placeholder="e.g. 500,000"
            value={requestedAmount}
            onChange={(e) => setRequestedAmount(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300">
            Purpose of Loan
          </label>
          <textarea
            className={inputCls + " resize-none"}
            rows={3}
            placeholder="Describe what you plan to use the funds for..."
            value={loanPurpose}
            onChange={(e) => setLoanPurpose(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300">
            Desired Term (months)
          </label>
          <input
            type="number"
            step="1"
            className={inputCls}
            placeholder="e.g. 120"
            value={termMonths}
            onChange={(e) => setTermMonths(e.target.value)}
          />
        </div>
      </div>

      {/* Real Estate Fields */}
      {showRealEstate && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 space-y-4">
          <div className="text-sm font-medium text-neutral-400 uppercase tracking-wider">
            Property Details
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300">
              Property Type
            </label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. Office, Retail, Industrial, Multi-Family"
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-300">
                Property Value
              </label>
              <input
                type="text"
                inputMode="decimal"
                className={inputCls}
                placeholder="e.g. 750,000"
                value={propertyValue}
                onChange={(e) => setPropertyValue(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300">
                Purchase Price
              </label>
              <input
                type="text"
                inputMode="decimal"
                className={inputCls}
                placeholder="e.g. 700,000"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* SBA Fields */}
      {showSba && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 space-y-4">
          <div className="text-sm font-medium text-neutral-400 uppercase tracking-wider">
            SBA Details
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300">
              SBA Program
            </label>
            <select
              className={inputCls}
              value={sbaProgram}
              onChange={(e) => setSbaProgram(e.target.value)}
            >
              <option value="">Select program...</option>
              <option value="7A">SBA 7(a)</option>
              <option value="504">SBA 504</option>
              <option value="EXPRESS">SBA Express</option>
              <option value="COMMUNITY_ADVANTAGE">Community Advantage</option>
            </select>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={saving || !productType}
        className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Submitting..." : "Submit Loan Request"}
      </button>
    </form>
  );
}
