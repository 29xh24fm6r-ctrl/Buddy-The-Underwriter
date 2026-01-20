"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { FormFieldWithDefault } from "@/components/deals/FormFieldWithDefault";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";
import { useAnchorAutofocus } from "@/lib/deepLinks/useAnchorAutofocus";
import { cn } from "@/lib/utils";

interface PolicyDefault {
  field_name: string;
  field_label: string;
  field_type: string;
  default_value: any;
  confidence_score: number;
  source_text: string;
  min_value?: number | null;
  max_value?: number | null;
}

interface LoanTerms {
  interest_rate: string;
  guarantee_fee: string;
  term_months: string;
  down_payment_pct: string;
  max_ltv: string;
  min_dscr: string;
  min_fico: string;
  max_loan_amount: string;
}

export default function LoanTermsFormPage() {
  const params = useParams();
  const dealId = params?.dealId as string;

  const highlightLoanRequest = useAnchorAutofocus("loan-request");

  const [dealType, setDealType] = useState("sba_7a");
  const [industry, setIndustry] = useState("");
  const [policyDefaults, setPolicyDefaults] = useState<Map<string, PolicyDefault>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState<LoanTerms>({
    interest_rate: "",
    guarantee_fee: "",
    term_months: "",
    down_payment_pct: "",
    max_ltv: "",
    min_dscr: "",
    min_fico: "",
    max_loan_amount: "",
  });

  useEffect(() => {
    loadDefaults();
  }, [dealType, industry]);

  async function loadDefaults() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dealType) params.set("deal_type", dealType);
      if (industry) params.set("industry", industry);

      const res = await fetch(`/api/banks/policy/form-defaults?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const json = await res.json();
      const defaultsMap = new Map<string, PolicyDefault>();
      
      for (const def of json.defaults || []) {
        defaultsMap.set(def.field_name, def);
      }
      
      setPolicyDefaults(defaultsMap);

      // Auto-fill empty fields with policy defaults
      setFormData((prev) => {
        const updated = { ...prev };
        for (const [fieldName, policyDefault] of defaultsMap) {
          if (!prev[fieldName as keyof LoanTerms]) {
            updated[fieldName as keyof LoanTerms] = policyDefault.default_value?.toString() || "";
          }
        }
        return updated;
      });
    } catch (err: any) {
      console.error("Failed to load policy defaults:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleFieldChange(fieldName: keyof LoanTerms, value: string | number) {
    setFormData((prev) => ({
      ...prev,
      [fieldName]: value.toString(),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    try {
      setSaving(true);

      if (!dealId) throw new Error("Missing dealId");

      const toNumber = (value: string) => {
        const cleaned = value.replace(/[^0-9.\-]/g, "");
        if (!cleaned) return null;
        const num = Number(cleaned);
        return Number.isFinite(num) ? num : null;
      };

      const payload = {
        loan_amount: toNumber(formData.max_loan_amount),
        term_months: toNumber(formData.term_months) ?? undefined,
        notes: JSON.stringify({
          interest_rate: formData.interest_rate || null,
          guarantee_fee: formData.guarantee_fee || null,
          down_payment_pct: formData.down_payment_pct || null,
          max_ltv: formData.max_ltv || null,
          min_dscr: formData.min_dscr || null,
          min_fico: formData.min_fico || null,
        }),
      };

      const res = await fetch(`/api/deals/${dealId}/pricing/inputs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }

      try {
        await fetch(`/api/deals/${dealId}/context`, { cache: "no-store" });
      } catch {
        // ignore best-effort refresh
      }

      emitBuddySignal({
        type: "deal.loaded",
        source: "app/(app)/deals/[dealId]/loan-terms/page.tsx",
        dealId,
        payload: { trigger: "loan_terms_saved" },
      });
      
      // Track deviations from policy defaults
      const deviations = [];
      for (const [fieldName, value] of Object.entries(formData)) {
        const policyDefault = policyDefaults.get(fieldName);
        if (policyDefault && value !== policyDefault.default_value?.toString()) {
          deviations.push({
            field_name: fieldName,
            field_label: policyDefault.field_label,
            policy_default: policyDefault.default_value,
            actual_value: value,
          });
        }
      }
      
      if (deviations.length > 0) {
        console.log("Policy deviations detected:", deviations);
        // You would save these to deal_policy_deviations table
      }
      
      alert("✅ Loan terms saved successfully!");
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Loan Terms</h1>
        <p className="text-muted-foreground mt-1">
          Configure loan terms with policy-compliant defaults
        </p>
      </div>

      {/* Deal type selector */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Deal Type
            </label>
            <select
              value={dealType}
              onChange={(e) => setDealType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="sba_7a">SBA 7(a)</option>
              <option value="sba_504">SBA 504</option>
              <option value="conventional">Conventional</option>
              <option value="equipment">Equipment Financing</option>
              <option value="term_loan">Term Loan</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Industry (Optional)
            </label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">All Industries</option>
              <option value="restaurant">Restaurant</option>
              <option value="retail">Retail</option>
              <option value="manufacturing">Manufacturing</option>
              <option value="commercial_real_estate">Commercial Real Estate</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
          Loading policy defaults...
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className={cn(
            "bg-white border rounded-lg p-6 space-y-6 transition",
            highlightLoanRequest && "ring-2 ring-sky-400/60 bg-sky-500/5",
          )}
          id="loan-request"
        >
          {/* Pricing section */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <FormFieldWithDefault
                fieldName="interest_rate"
                label="Interest Rate"
                value={formData.interest_rate}
                onChange={(v) => handleFieldChange("interest_rate", v)}
                policyDefault={policyDefaults.get("interest_rate")}
                type="text"
                placeholder="e.g., Prime + 2.75%"
              />
              <FormFieldWithDefault
                fieldName="guarantee_fee"
                label="Guarantee Fee"
                value={formData.guarantee_fee}
                onChange={(v) => handleFieldChange("guarantee_fee", v)}
                policyDefault={policyDefaults.get("guarantee_fee")}
                type="percentage"
                placeholder="2.0"
              />
            </div>
          </div>

          {/* Term section */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Term</h3>
            <div className="grid grid-cols-2 gap-4">
              <FormFieldWithDefault
                fieldName="term_months"
                label="Loan Term (Months)"
                value={formData.term_months}
                onChange={(v) => handleFieldChange("term_months", v)}
                policyDefault={policyDefaults.get("term_months")}
                type="number"
                placeholder="120"
              />
              <FormFieldWithDefault
                fieldName="down_payment_pct"
                label="Down Payment"
                value={formData.down_payment_pct}
                onChange={(v) => handleFieldChange("down_payment_pct", v)}
                policyDefault={policyDefaults.get("down_payment_pct")}
                type="percentage"
                placeholder="10"
              />
            </div>
          </div>

          {/* Credit criteria section */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Credit Criteria</h3>
            <div className="grid grid-cols-2 gap-4">
              <FormFieldWithDefault
                fieldName="max_ltv"
                label="Maximum LTV"
                value={formData.max_ltv}
                onChange={(v) => handleFieldChange("max_ltv", v)}
                policyDefault={policyDefaults.get("max_ltv")}
                type="percentage"
                placeholder="80"
              />
              <FormFieldWithDefault
                fieldName="min_dscr"
                label="Minimum DSCR"
                value={formData.min_dscr}
                onChange={(v) => handleFieldChange("min_dscr", v)}
                policyDefault={policyDefaults.get("min_dscr")}
                type="number"
                placeholder="1.25"
              />
              <FormFieldWithDefault
                fieldName="min_fico"
                label="Minimum FICO Score"
                value={formData.min_fico}
                onChange={(v) => handleFieldChange("min_fico", v)}
                policyDefault={policyDefaults.get("min_fico")}
                type="number"
                placeholder="660"
              />
              <FormFieldWithDefault
                fieldName="max_loan_amount"
                label="Maximum Loan Amount"
                value={formData.max_loan_amount}
                onChange={(v) => handleFieldChange("max_loan_amount", v)}
                policyDefault={policyDefaults.get("max_loan_amount")}
                type="currency"
                placeholder="5000000"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Loan Terms"}
            </button>
            <button
              type="button"
              onClick={loadDefaults}
              className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Reset to Policy Defaults
            </button>
          </div>

          {/* Info */}
          {policyDefaults.size === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex gap-2">
                <span className="text-yellow-600">⚠️</span>
                <div className="text-sm text-yellow-800">
                  No policy defaults found for this deal type. Upload and ingest policy documents first.
                </div>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
