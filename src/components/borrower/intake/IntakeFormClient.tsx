"use client";

// src/components/borrower/intake/IntakeFormClient.tsx
// Phase 85A — Mobile-first borrower intake form
// Phase 85A.2 — Extended from 4 steps to 5 (added Owners as step 3;
//               loan moved to step 4, review to step 5).
//
// CSS note: (borrower)/layout.tsx sets text-neutral-100 on the outer div.
// All inputs MUST have explicit text-gray-900 bg-white placeholder-gray-400
// to avoid invisible white-on-white text.

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  IntakeBusinessData,
  IntakeAddressData,
  IntakeOwnerData,
  IntakeLoanData,
  IntakeStep,
  IntakeStepKey,
  IntakeSaveResponse,
} from "@/types/intake";
import { PortalUploadDropzone } from "./PortalUploadDropzone";

// ─── Constants ───

const ENTITY_TYPE_OPTIONS = [
  { value: "", label: "Select entity type…" },
  { value: "LLC", label: "LLC" },
  { value: "Corporation", label: "Corporation" },
  { value: "S-Corporation", label: "S-Corporation" },
  { value: "Partnership", label: "Partnership" },
  { value: "Sole Proprietorship", label: "Sole Proprietorship" },
];

const LOAN_TYPE_OPTIONS = [
  { value: "", label: "Select loan type…" },
  { value: "SBA", label: "SBA 7(a)" },
  { value: "sba_504", label: "SBA 504" },
  { value: "sba_express", label: "SBA Express" },
  { value: "CRE", label: "Commercial Real Estate" },
  { value: "C&I", label: "Commercial & Industrial" },
  { value: "LOC", label: "Line of Credit" },
];

const US_STATES = [
  "", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];

const STEP_LABELS = [
  "Business Info",
  "Business Address",
  "Owners",
  "Loan Request",
  "Documents",
  "Review & Submit",
];

const TOTAL_STEPS = STEP_LABELS.length as 6;

// ─── Props ───

type ExistingSection = { section_key: string; data: Record<string, unknown>; completed: boolean };

type Props = {
  token: string;
  dealId: string;
  bankId: string;
  deal: { id: string; name: string | null; deal_type: string | null; loan_amount: number | null } | null;
  borrower: {
    id: string; legal_name: string; entity_type: string | null;
    ein: string | null; naics_code: string | null; naics_description: string | null;
    address_line1: string | null; city: string | null; state: string | null;
    zip: string | null; state_of_formation: string | null;
    primary_contact_name: string | null; primary_contact_email: string | null;
  } | null;
  existingSections: ExistingSection[];
  existingApplication: {
    id: string; status: string;
    business_legal_name: string | null; business_dba: string | null;
    business_ein: string | null; business_entity_type: string | null;
    naics: string | null; industry: string | null;
    loan_purpose: string | null; loan_amount: number | null; loan_type: string | null;
  } | null;
};

// ─── Helpers ───

function sectionData(sections: ExistingSection[], key: string): Record<string, unknown> | null {
  const s = sections.find((x) => x.section_key === key);
  return s ? (s.data as Record<string, unknown>) : null;
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

const selectCls =
  "w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

const labelCls = "block text-sm font-medium text-gray-300 mb-1.5";

// ─── Component ───

export function IntakeFormClient({ token, dealId, deal, borrower, existingSections, existingApplication }: Props) {
  // --- Initialize state from existing data ---
  const app = existingApplication;
  const bizSection = sectionData(existingSections, "business");
  const addrSection = sectionData(existingSections, "address");
  const ownersSection = sectionData(existingSections, "owners");
  const loanSection = sectionData(existingSections, "loan");

  const [step, setStep] = useState<IntakeStep>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(app?.status === "submitted");

  const [business, setBusiness] = useState<IntakeBusinessData>({
    legal_name: (app?.business_legal_name ?? bizSection?.legal_name ?? deal?.name ?? "") as string,
    dba: (app?.business_dba ?? bizSection?.dba ?? "") as string,
    ein: (app?.business_ein ?? bizSection?.ein ?? borrower?.ein ?? "") as string,
    entity_type: ((app?.business_entity_type ?? bizSection?.entity_type ?? borrower?.entity_type ?? "") as IntakeBusinessData["entity_type"]),
    naics_code: (app?.naics ?? bizSection?.naics_code ?? borrower?.naics_code ?? "") as string,
    industry_description: (app?.industry ?? bizSection?.industry_description ?? borrower?.naics_description ?? "") as string,
  });

  const [address, setAddress] = useState<IntakeAddressData>({
    address_line1: (addrSection?.address_line1 ?? borrower?.address_line1 ?? "") as string,
    city: (addrSection?.city ?? borrower?.city ?? "") as string,
    state: (addrSection?.state ?? borrower?.state ?? "") as string,
    zip: (addrSection?.zip ?? borrower?.zip ?? "") as string,
    state_of_formation: (addrSection?.state_of_formation ?? borrower?.state_of_formation ?? "") as string,
  });

  const [owners, setOwners] = useState<IntakeOwnerData[]>(() => {
    const list = ownersSection?.owners;
    if (Array.isArray(list)) return list as IntakeOwnerData[];
    return [];
  });

  const [loan, setLoan] = useState<IntakeLoanData>({
    purpose: (app?.loan_purpose ?? loanSection?.purpose ?? "") as string,
    amount: (app?.loan_amount?.toString() ?? loanSection?.amount?.toString() ?? deal?.loan_amount?.toString() ?? "") as string,
    type: ((app?.loan_type ?? loanSection?.type ?? (deal?.deal_type === "SBA" ? "SBA" : "")) as IntakeLoanData["type"]),
  });

  // Phase 85A.3 — track uploaded document count for Step 5 + review
  const [uploadCount, setUploadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadUploadCount() {
      try {
        const res = await fetch(`/api/portal/${token}/docs`);
        const json = await res.json();
        if (cancelled) return;
        // Route returns { ok: true, count, docs: [...] } (85A.3) OR
        // { deal_id, docs: [...] } (pre-85A.3) — handle both shapes.
        if (typeof json?.count === "number") {
          setUploadCount(json.count);
        } else if (Array.isArray(json?.docs)) {
          setUploadCount(json.docs.length);
        }
      } catch {
        // non-fatal
      }
    }
    loadUploadCount();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // --- Auto-save debounce ---
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");

  const save = useCallback(
    async (stepKey: IntakeStepKey, data: Record<string, unknown>) => {
      const sig = JSON.stringify({ stepKey, data });
      if (sig === lastSavedRef.current) return;
      lastSavedRef.current = sig;

      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/borrower/portal/${token}/intake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: stepKey, data }),
        });
        const json: IntakeSaveResponse = await res.json();
        if (!json.ok) {
          setError(json.error);
        }
      } catch {
        setError("Network error — your progress may not have saved.");
      } finally {
        setSaving(false);
      }
    },
    [token]
  );

  const debouncedSave = useCallback(
    (stepKey: IntakeStepKey, data: Record<string, unknown>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(stepKey, data), 500);
    },
    [save]
  );

  // Auto-save on data change
  useEffect(() => {
    if (step === 1) debouncedSave("business", business as unknown as Record<string, unknown>);
  }, [business, step, debouncedSave]);

  useEffect(() => {
    if (step === 2) debouncedSave("address", address as unknown as Record<string, unknown>);
  }, [address, step, debouncedSave]);

  useEffect(() => {
    if (step === 3) debouncedSave("owners", { owners } as unknown as Record<string, unknown>);
  }, [owners, step, debouncedSave]);

  useEffect(() => {
    if (step === 4) debouncedSave("loan", loan as unknown as Record<string, unknown>);
  }, [loan, step, debouncedSave]);

  // --- Navigation ---
  const goNext = useCallback(() => {
    if (step === 1 && !business.legal_name.trim()) {
      setError("Business legal name is required.");
      return;
    }
    if (step < TOTAL_STEPS) setStep((s) => (s + 1) as IntakeStep);
    setError(null);
  }, [step, business.legal_name]);

  const goBack = useCallback(() => {
    if (step > 1) setStep((s) => (s - 1) as IntakeStep);
    setError(null);
  }, [step]);

  const handleSubmit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/borrower/portal/${token}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "submit", data: {} }),
      });
      const json: IntakeSaveResponse = await res.json();
      if (json.ok) {
        setSubmitted(true);
      } else {
        setError(json.error);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }, [token]);

  // --- Submitted state ---
  if (submitted) {
    return (
      <div className="max-w-lg mx-auto py-12 text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-900/30 border border-green-700">
          <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white">Application Submitted</h1>
        <p className="text-sm text-gray-400">
          Your loan application has been submitted successfully. Your banker will review
          it and reach out with next steps.
        </p>
      </div>
    );
  }

  // --- Render ---
  return (
    <div className="max-w-lg mx-auto py-6 space-y-6">
      {/* Progress bar */}
      <div className="flex items-center justify-between px-2">
        {STEP_LABELS.map((label, i) => {
          const stepNum = (i + 1) as IntakeStep;
          const isComplete = stepNum < step;
          const isCurrent = stepNum === step;
          return (
            <div key={label} className="flex flex-col items-center flex-1">
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                  ${isComplete ? "bg-green-600 text-white" : ""}
                  ${isCurrent ? "bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-2 ring-offset-neutral-950" : ""}
                  ${!isComplete && !isCurrent ? "bg-neutral-800 text-neutral-500" : ""}
                `}
              >
                {isComplete ? "✓" : stepNum}
              </div>
              <span className={`text-[10px] mt-1 text-center ${isCurrent ? "text-blue-400 font-medium" : "text-neutral-600"}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Step content */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-5">
        {step === 1 && (
          <>
            <h2 className="text-lg font-semibold text-white">Business Information</h2>
            <div>
              <label className={labelCls}>Legal Business Name *</label>
              <input className={inputCls} value={business.legal_name}
                onChange={(e) => setBusiness((b) => ({ ...b, legal_name: e.target.value }))}
                placeholder="Acme Corp LLC" />
            </div>
            <div>
              <label className={labelCls}>DBA / Trade Name</label>
              <input className={inputCls} value={business.dba}
                onChange={(e) => setBusiness((b) => ({ ...b, dba: e.target.value }))}
                placeholder="Acme Corp" />
            </div>
            <div>
              <label className={labelCls}>EIN</label>
              <input className={inputCls} value={business.ein}
                onChange={(e) => setBusiness((b) => ({ ...b, ein: e.target.value }))}
                placeholder="XX-XXXXXXX" maxLength={10} />
            </div>
            <div>
              <label className={labelCls}>Entity Type</label>
              <select className={selectCls} value={business.entity_type}
                onChange={(e) => setBusiness((b) => ({ ...b, entity_type: e.target.value as IntakeBusinessData["entity_type"] }))}>
                {ENTITY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>NAICS Code</label>
              <input className={inputCls} value={business.naics_code}
                onChange={(e) => setBusiness((b) => ({ ...b, naics_code: e.target.value }))}
                placeholder="e.g. 722511" maxLength={6} />
            </div>
            <div>
              <label className={labelCls}>Industry Description</label>
              <input className={inputCls} value={business.industry_description}
                onChange={(e) => setBusiness((b) => ({ ...b, industry_description: e.target.value }))}
                placeholder="Full-service restaurants" />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-lg font-semibold text-white">Business Address</h2>
            <div>
              <label className={labelCls}>Street Address</label>
              <input className={inputCls} value={address.address_line1}
                onChange={(e) => setAddress((a) => ({ ...a, address_line1: e.target.value }))}
                placeholder="123 Main St" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>City</label>
                <input className={inputCls} value={address.city}
                  onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                  placeholder="Springfield" />
              </div>
              <div>
                <label className={labelCls}>State</label>
                <select className={selectCls} value={address.state}
                  onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value }))}>
                  <option value="">Select…</option>
                  {US_STATES.filter(Boolean).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>ZIP Code</label>
                <input className={inputCls} value={address.zip}
                  onChange={(e) => setAddress((a) => ({ ...a, zip: e.target.value }))}
                  placeholder="62701" maxLength={10} />
              </div>
              <div>
                <label className={labelCls}>State of Formation</label>
                <select className={selectCls} value={address.state_of_formation}
                  onChange={(e) => setAddress((a) => ({ ...a, state_of_formation: e.target.value }))}>
                  <option value="">Select…</option>
                  {US_STATES.filter(Boolean).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-lg font-semibold text-white">Business Owners</h2>
            <p className="text-sm text-gray-400">
              List anyone who owns 20% or more of the business. We&apos;ll need
              personal financial documents from each.
            </p>

            {owners.map((owner, idx) => (
              <div key={owner.id} className="border border-neutral-800 rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-300">Owner {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setOwners((prev) => prev.filter((o) => o.id !== owner.id))
                    }
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Full Name *</label>
                    <input
                      className={inputCls}
                      value={owner.full_name}
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o) =>
                            o.id === owner.id ? { ...o, full_name: e.target.value } : o,
                          ),
                        )
                      }
                      placeholder="Jane Smith"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Title</label>
                    <input
                      className={inputCls}
                      value={owner.title}
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o) =>
                            o.id === owner.id ? { ...o, title: e.target.value } : o,
                          ),
                        )
                      }
                      placeholder="Managing Member"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Ownership %</label>
                    <input
                      className={inputCls}
                      value={owner.ownership_pct}
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o) =>
                            o.id === owner.id ? { ...o, ownership_pct: e.target.value } : o,
                          ),
                        )
                      }
                      placeholder="51"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>SSN Last 4</label>
                    <input
                      className={inputCls}
                      value={owner.ssn_last4}
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o) =>
                            o.id === owner.id ? { ...o, ssn_last4: e.target.value } : o,
                          ),
                        )
                      }
                      placeholder="1234"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Yrs in Industry</label>
                    <input
                      className={inputCls}
                      value={owner.years_in_industry}
                      type="text"
                      inputMode="numeric"
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o) =>
                            o.id === owner.id
                              ? { ...o, years_in_industry: e.target.value }
                              : o,
                          ),
                        )
                      }
                      placeholder="10"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setOwners((prev) => [
                  ...prev,
                  {
                    id:
                      typeof crypto !== "undefined" && "randomUUID" in crypto
                        ? crypto.randomUUID()
                        : `owner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    full_name: "",
                    title: "",
                    ownership_pct: "",
                    ssn_last4: "",
                    years_in_industry: "",
                  },
                ])
              }
              className="w-full py-3 rounded-lg border border-dashed border-neutral-700 text-gray-400 text-sm hover:border-neutral-500 hover:text-gray-300 transition min-h-[44px]"
            >
              + Add Owner
            </button>

            {owners.length === 0 && (
              <div className="bg-amber-900/20 border border-amber-800 rounded-lg px-4 py-3 text-xs text-amber-300">
                At least one owner is required for loan applications. Add anyone
                who owns 20% or more of the business.
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-lg font-semibold text-white">Loan Request</h2>
            <div>
              <label className={labelCls}>Loan Type</label>
              <select className={selectCls} value={loan.type}
                onChange={(e) => setLoan((l) => ({ ...l, type: e.target.value as IntakeLoanData["type"] }))}>
                {LOAN_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Requested Amount ($)</label>
              <input className={inputCls} value={loan.amount} type="text" inputMode="numeric"
                onChange={(e) => setLoan((l) => ({ ...l, amount: e.target.value }))}
                placeholder="250,000" />
            </div>
            <div>
              <label className={labelCls}>Loan Purpose</label>
              <input className={inputCls} value={loan.purpose}
                onChange={(e) => setLoan((l) => ({ ...l, purpose: e.target.value }))}
                placeholder="Working capital, equipment purchase, etc." />
            </div>
            {["SBA", "sba_7a", "sba_504", "sba_express"].includes(loan.type) && (
              <div className="bg-blue-900/20 border border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-300">
                SBA loans are backed by the U.S. Small Business Administration. Your banker will
                determine specific program eligibility during underwriting.
              </div>
            )}
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-lg font-semibold text-white">Upload Documents</h2>
            <p className="text-sm text-gray-400">
              Upload any financial documents you have available. Your banker
              will let you know if anything else is needed.
            </p>

            <PortalUploadDropzone
              token={token}
              dealId={dealId}
              onUploadComplete={() => setUploadCount((prev) => prev + 1)}
            />

            {uploadCount > 0 && (
              <div className="bg-green-900/20 border border-green-800 rounded-lg px-4 py-3">
                <p className="text-sm text-green-300 font-medium">
                  {uploadCount} document{uploadCount !== 1 ? "s" : ""} uploaded so far
                </p>
              </div>
            )}

            <div className="bg-blue-900/20 border border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-300">
              Don&apos;t have everything right now? No problem — you can upload more
              documents after submitting your application. Your banker will send
              you a checklist of anything that&apos;s still needed.
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <h2 className="text-lg font-semibold text-white">Review & Submit</h2>
            <div className="space-y-4 text-sm">
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Business</h3>
                <div className="space-y-1 text-gray-300">
                  <p><span className="text-gray-500">Legal Name:</span> {business.legal_name || "—"}</p>
                  {business.dba && <p><span className="text-gray-500">DBA:</span> {business.dba}</p>}
                  {business.ein && <p><span className="text-gray-500">EIN:</span> {business.ein}</p>}
                  {business.entity_type && <p><span className="text-gray-500">Type:</span> {business.entity_type}</p>}
                  {business.naics_code && <p><span className="text-gray-500">NAICS:</span> {business.naics_code}</p>}
                </div>
              </div>
              <div className="border-t border-neutral-800 pt-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Address</h3>
                <div className="text-gray-300">
                  {address.address_line1 && <p>{address.address_line1}</p>}
                  <p>
                    {[address.city, address.state, address.zip].filter(Boolean).join(", ") || "—"}
                  </p>
                </div>
              </div>
              <div className="border-t border-neutral-800 pt-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Owners</h3>
                {owners.length === 0 ? (
                  <p className="text-gray-500 text-sm">No owners added</p>
                ) : (
                  <div className="space-y-1 text-gray-300">
                    {owners.map((o) => (
                      <p key={o.id}>
                        <span className="text-gray-500">{o.full_name || "—"}</span>
                        {o.ownership_pct && ` — ${o.ownership_pct}%`}
                        {o.title && ` (${o.title})`}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t border-neutral-800 pt-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Loan</h3>
                <div className="space-y-1 text-gray-300">
                  {loan.type && <p><span className="text-gray-500">Type:</span> {LOAN_TYPE_OPTIONS.find(o => o.value === loan.type)?.label ?? loan.type}</p>}
                  {loan.amount && <p><span className="text-gray-500">Amount:</span> ${Number(loan.amount.replace(/[^0-9.]/g, "")).toLocaleString()}</p>}
                  {loan.purpose && <p><span className="text-gray-500">Purpose:</span> {loan.purpose}</p>}
                </div>
              </div>
              <div className="border-t border-neutral-800 pt-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Documents</h3>
                <p className="text-gray-300 text-sm">
                  {uploadCount > 0
                    ? `${uploadCount} document${uploadCount !== 1 ? "s" : ""} uploaded`
                    : "No documents uploaded yet"}
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 1 && (
          <button
            onClick={goBack}
            className="flex-1 sm:flex-none px-6 py-3 rounded-lg border border-neutral-700 text-gray-300 text-sm font-medium hover:bg-neutral-800 transition min-h-[44px]"
          >
            Back
          </button>
        )}
        {step < TOTAL_STEPS ? (
          <button
            onClick={goNext}
            disabled={saving}
            className="flex-1 px-6 py-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 min-h-[44px]"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 px-6 py-3 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition disabled:opacity-50 min-h-[44px]"
          >
            {saving ? "Submitting…" : "Submit Application"}
          </button>
        )}
      </div>

      {/* Save indicator */}
      {saving && (
        <p className="text-center text-xs text-neutral-600">Saving…</p>
      )}
    </div>
  );
}
