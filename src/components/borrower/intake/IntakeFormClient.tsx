"use client";

// src/components/borrower/intake/IntakeFormClient.tsx
// Phase 85A — Mobile-first borrower intake form
// Phase 85A.2 — Extended from 4 steps to 5 (added Owners as step 3;
//               loan moved to step 4, review to step 5).
//
// CSS note: (borrower)/layout.tsx sets a light theme (bg-white text-slate-900)
// on the outer div. All inputs MUST have explicit text-gray-900 bg-white
// placeholder-gray-400 to avoid invisible white-on-white text.

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  IntakeBusinessData,
  IntakeAddressData,
  IntakeOwnerData,
  IntakeLoanData,
  IntakeComplianceData,
  IntakeComplianceAnswer,
  IntakeDebtRowData,
  IntakeDebtData,
  IntakePFSRealEstateRow,
  IntakePFSSecurityRow,
  IntakePFSNotePayableRow,
  IntakeStep,
  IntakeStepKey,
  IntakeStepContent,
  IntakeSaveResponse,
} from "@/types/intake";
import { PortalUploadDropzone } from "./PortalUploadDropzone";
import { AssumptionInterview } from "./AssumptionInterview";
import { ApprovalScoreCard } from "./ApprovalScoreCard";
import { IdentityVerificationPanel } from "./IdentityVerificationPanel";
import { PostSubmitHub } from "./PostSubmitHub";

const SBA_LOAN_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

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

const STEP_LABELS_NON_SBA = [
  "Business Info",
  "Business Address",
  "Owners",
  "Loan Request",
  "Documents",
  "Review & Submit",
];

const STEP_LABELS_SBA = [
  "Business Info",
  "Business Address",
  "Owners",
  "Personal Finances",
  "Loan Request",
  "Existing Debt",
  "SBA Compliance",
  "Financial Projections",
  "Documents",
  "Review & Submit",
];

const DEBT_LOAN_TYPE_OPTIONS = [
  { value: "mortgage", label: "Mortgage" },
  { value: "auto", label: "Auto Loan" },
  { value: "equipment", label: "Equipment Loan" },
  { value: "line_of_credit", label: "Line of Credit" },
  { value: "sba_loan", label: "SBA Loan" },
  { value: "other", label: "Other" },
];

function contentAt(s: number, isSba: boolean): IntakeStepContent {
  if (s === 1) return "business";
  if (s === 2) return "address";
  if (s === 3) return "owners";
  if (isSba) {
    if (s === 4) return "pfs";
    if (s === 5) return "loan";
    if (s === 6) return "debt";
    if (s === 7) return "compliance";
    if (s === 8) return "projections";
    if (s === 9) return "documents";
    return "review";
  }
  if (s === 4) return "loan";
  if (s === 5) return "documents";
  return "review";
}

// SBA-required federal-compliance / character disclosures (SBA Forms
// 1919 / 912). A "yes" is a real SBA eligibility gate, not a soft flag —
// see src/lib/score/eligibility/evaluate.ts for how these feed scoring.
const COMPLIANCE_QUESTIONS: Array<{
  key: keyof IntakeComplianceData;
  question: string;
  helper: string;
}> = [
  {
    key: "federal_debt_delinquent",
    question: "Is the business, or any owner, currently delinquent on any federal debt (including federal taxes)?",
    helper: "This includes federal student loans, SBA loans, taxes, and other government debt.",
  },
  {
    key: "tax_delinquent",
    question: "Is the business, or any owner, currently delinquent on any tax obligation?",
    helper: "Federal, state, or local taxes.",
  },
  {
    key: "sam_debarred",
    question: "Is the business, or any owner, suspended or debarred from doing business with the federal government (SAM.gov)?",
    helper: "",
  },
  {
    key: "felony_conviction",
    question: "Has any owner been convicted of, pleaded guilty to, or been indicted for a felony?",
    helper: "",
  },
  {
    key: "incarcerated_or_parole",
    question: "Is any owner currently incarcerated, on parole, or on probation?",
    helper: "",
  },
  {
    key: "prior_gov_loan_default",
    question: "Has any owner ever defaulted on a government loan, resulting in a loss to the government?",
    helper: "Includes SBA loans, federal student loans, or other government-backed financing.",
  },
  {
    key: "has_affiliates",
    question: "Does the business have any affiliates (common ownership/control with other businesses)?",
    helper: "SBA counts affiliate revenue and employees toward the size-standard limit.",
  },
];

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

/**
 * A returning borrower should land on the first step they haven't finished,
 * not always step 1 — closing the tab after 15 minutes of work shouldn't
 * mean re-clicking through every already-completed screen. Only considers
 * the data-entry steps (documents/review aren't deal_builder_sections rows),
 * so a borrower who finished all of those resumes at Documents.
 */
export function deriveInitialStep(sections: ExistingSection[], isSba: boolean): IntakeStep {
  const dataSteps: IntakeStepContent[] = isSba
    ? ["business", "address", "owners", "pfs", "loan", "debt", "compliance", "projections"]
    : ["business", "address", "owners", "loan"];
  for (let i = 0; i < dataSteps.length; i++) {
    const section = sections.find((s) => s.section_key === dataSteps[i]);
    if (!section?.completed) return (i + 1) as IntakeStep;
  }
  return (dataSteps.length + 1) as IntakeStep;
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

const selectCls =
  "w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

const labelCls = "block text-sm font-medium text-slate-600 mb-1.5";

// ─── Component ───

export function IntakeFormClient({ token, dealId, deal, borrower, existingSections, existingApplication }: Props) {
  // --- Initialize state from existing data ---
  const app = existingApplication;
  const bizSection = sectionData(existingSections, "business");
  const addrSection = sectionData(existingSections, "address");
  const ownersSection = sectionData(existingSections, "owners");
  const loanSection = sectionData(existingSections, "loan");
  const complianceSection = sectionData(existingSections, "compliance");

  const resumeLoanType = (app?.loan_type ?? loanSection?.type ?? (deal?.deal_type === "SBA" ? "SBA" : "")) as string;
  const isSbaForResume = SBA_LOAN_TYPES.includes(resumeLoanType);

  const [step, setStep] = useState<IntakeStep>(() => deriveInitialStep(existingSections, isSbaForResume));
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
    if (!Array.isArray(list)) return [];
    // Defensively default email/phone for owners saved before those fields
    // existed, so the controlled inputs below never flip from uncontrolled
    // (undefined) to controlled (string) on first edit.
    return (list as Partial<IntakeOwnerData>[]).map((o) => ({
      id: o.id ?? "",
      full_name: o.full_name ?? "",
      title: o.title ?? "",
      ownership_pct: o.ownership_pct ?? "",
      ssn_last4: o.ssn_last4 ?? "",
      years_in_industry: o.years_in_industry ?? "",
      email: o.email ?? "",
      phone: o.phone ?? "",
    }));
  });

  const [loan, setLoan] = useState<IntakeLoanData>({
    purpose: (app?.loan_purpose ?? loanSection?.purpose ?? "") as string,
    amount: (app?.loan_amount?.toString() ?? loanSection?.amount?.toString() ?? deal?.loan_amount?.toString() ?? "") as string,
    type: ((app?.loan_type ?? loanSection?.type ?? (deal?.deal_type === "SBA" ? "SBA" : "")) as IntakeLoanData["type"]),
  });

  const boolToAnswer = (v: unknown): IntakeComplianceAnswer =>
    v === true ? "yes" : v === false ? "no" : "";

  const [compliance, setCompliance] = useState<IntakeComplianceData>({
    federal_debt_delinquent: boolToAnswer(complianceSection?.federal_debt_delinquent),
    tax_delinquent: boolToAnswer(complianceSection?.tax_delinquent),
    sam_debarred: boolToAnswer(complianceSection?.sam_debarred),
    felony_conviction: boolToAnswer(complianceSection?.felony_conviction),
    incarcerated_or_parole: boolToAnswer(complianceSection?.incarcerated_or_parole),
    prior_gov_loan_default: boolToAnswer(complianceSection?.prior_gov_loan_default),
    has_affiliates: boolToAnswer(complianceSection?.has_affiliates),
  });

  // --- Debt schedule state (Item 1) ---
  const debtSection = sectionData(existingSections, "debt");
  const [debt, setDebt] = useState<IntakeDebtData>({
    no_existing_debt: (debtSection?.no_existing_debt as boolean) ?? false,
    rows: (() => {
      const list = debtSection?.rows;
      if (!Array.isArray(list)) return [];
      return (list as Partial<IntakeDebtRowData>[]).map((r) => ({
        id: r.id ?? "",
        lender_name: r.lender_name ?? "",
        loan_type: r.loan_type ?? "",
        current_balance: r.current_balance ?? "",
        monthly_payment: r.monthly_payment ?? "",
        maturity_date: r.maturity_date ?? "",
        is_being_refinanced: r.is_being_refinanced ?? false,
      }));
    })(),
  });

  // --- PFS state (Item 4) ---
  const pfsSection = sectionData(existingSections, "pfs");
  const [pfsEntries, setPfsEntries] = useState<
    Array<{
      owner_entity_id: string;
      owner_name: string;
      real_estate: IntakePFSRealEstateRow[];
      securities: IntakePFSSecurityRow[];
      notes_payable: IntakePFSNotePayableRow[];
      total_assets: string;
      total_liabilities: string;
    }>
  >(() => {
    const entries = (pfsSection?.entries as unknown[]) ?? [];
    if (!Array.isArray(entries)) return [];
    return entries.map((e: any) => ({
      owner_entity_id: e.owner_entity_id ?? "",
      owner_name: e.owner_name ?? "",
      real_estate: Array.isArray(e.real_estate) ? e.real_estate : [],
      securities: Array.isArray(e.securities) ? e.securities : [],
      notes_payable: Array.isArray(e.notes_payable) ? e.notes_payable : [],
      total_assets: e.total_assets ?? "",
      total_liabilities: e.total_liabilities ?? "",
    }));
  });

  const isSba = SBA_LOAN_TYPES.includes(loan.type);
  const STEP_LABELS = isSba ? STEP_LABELS_SBA : STEP_LABELS_NON_SBA;
  const TOTAL_STEPS = STEP_LABELS.length as 6 | 8 | 10;
  const currentContent = contentAt(step, isSba);

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
    if (currentContent === "business") debouncedSave("business", business as unknown as Record<string, unknown>);
  }, [business, currentContent, debouncedSave]);

  useEffect(() => {
    if (currentContent === "address") debouncedSave("address", address as unknown as Record<string, unknown>);
  }, [address, currentContent, debouncedSave]);

  useEffect(() => {
    if (currentContent === "owners") debouncedSave("owners", { owners } as unknown as Record<string, unknown>);
  }, [owners, currentContent, debouncedSave]);

  useEffect(() => {
    if (currentContent === "loan") debouncedSave("loan", loan as unknown as Record<string, unknown>);
  }, [loan, currentContent, debouncedSave]);

  useEffect(() => {
    if (currentContent === "compliance") debouncedSave("compliance", compliance as unknown as Record<string, unknown>);
  }, [compliance, currentContent, debouncedSave]);

  useEffect(() => {
    if (currentContent === "debt") debouncedSave("debt", debt as unknown as Record<string, unknown>);
  }, [debt, currentContent, debouncedSave]);

  useEffect(() => {
    if (currentContent === "pfs") debouncedSave("pfs", { entries: pfsEntries } as unknown as Record<string, unknown>);
  }, [pfsEntries, currentContent, debouncedSave]);

  // Auto-populate PFS entries from owners when arriving at the PFS step for
  // the first time (no saved pfs section, owners already entered).
  const pfsInitRef = useRef(false);
  useEffect(() => {
    if (currentContent !== "pfs" || pfsInitRef.current) return;
    pfsInitRef.current = true;
    if (pfsEntries.length > 0) return;
    const qualifying = owners.filter((o) => o.full_name.trim());
    if (qualifying.length === 0) return;
    setPfsEntries(
      qualifying.map((o) => ({
        owner_entity_id: o.id,
        owner_name: o.full_name,
        real_estate: [],
        securities: [],
        notes_payable: [],
        total_assets: "",
        total_liabilities: "",
      })),
    );
  }, [currentContent, owners, pfsEntries.length]);

  // --- Navigation ---
  const goNext = useCallback(async () => {
    if (step === 1 && !business.legal_name.trim()) {
      setError("Business legal name is required.");
      return;
    }
    if (currentContent === "compliance") {
      const unanswered = COMPLIANCE_QUESTIONS.some((q) => compliance[q.key] === "");
      if (unanswered) {
        setError("Please answer every question — these are required on every SBA application.");
        return;
      }
    }
    // Phase 85-BPG-A — on leaving the SBA Financial Projections step, mark
    // assumptions as confirmed so the downstream forward model can run.
    if (currentContent === "projections") {
      try {
        await fetch(`/api/borrower/portal/${token}/sba-assumptions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patch: { status: "confirmed" } }),
        });
      } catch {
        // non-fatal — banker can reconfirm later
      }
    }
    if (step < TOTAL_STEPS) setStep((s) => (s + 1) as IntakeStep);
    setError(null);
  }, [step, business.legal_name, currentContent, compliance, token, TOTAL_STEPS]);

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
    return <PostSubmitHub token={token} />;
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
                  ${isComplete ? "bg-emerald-500 text-white" : ""}
                  ${isCurrent ? "bg-brand-blue-500 text-white ring-2 ring-brand-blue-400 ring-offset-2 ring-offset-[#f6f8fb]" : ""}
                  ${!isComplete && !isCurrent ? "bg-slate-200 text-slate-500" : ""}
                `}
              >
                {isComplete ? "✓" : stepNum}
              </div>
              <span className={`text-[10px] mt-1 text-center ${isCurrent ? "text-brand-blue-500 font-medium" : "text-slate-400"}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      )}

      {/* Step content */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-sm">
        {currentContent === "business" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Business Information</h2>
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

        {currentContent === "address" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Business Address</h2>
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

        {currentContent === "owners" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Business Owners</h2>
            <p className="text-sm text-slate-500">
              List anyone who owns 20% or more of the business. We&apos;ll need
              personal financial documents from each.
            </p>

            {owners.map((owner, idx) => (
              <div key={owner.id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">Owner {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setOwners((prev) => prev.filter((o) => o.id !== owner.id))
                    }
                    className="text-xs text-rose-500 hover:text-rose-600"
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      className={inputCls}
                      value={owner.email}
                      type="email"
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o) =>
                            o.id === owner.id ? { ...o, email: e.target.value } : o,
                          ),
                        )
                      }
                      placeholder="jane@example.com"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Phone</label>
                    <input
                      className={inputCls}
                      value={owner.phone}
                      type="tel"
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o) =>
                            o.id === owner.id ? { ...o, phone: e.target.value } : o,
                          ),
                        )
                      }
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>
                {owner.ownership_pct && Number(owner.ownership_pct) >= 20 && (!owner.email || !owner.phone) && (
                  <p className="text-xs text-amber-700">
                    Owners of 20% or more need their own financial statement and signature —
                    an email or phone lets your banker reach them directly.
                  </p>
                )}
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
                    email: "",
                    phone: "",
                  },
                ])
              }
              className="w-full py-3 rounded-lg border border-dashed border-slate-300 text-slate-500 text-sm hover:border-slate-400 hover:text-slate-600 transition min-h-[44px]"
            >
              + Add Owner
            </button>

            {owners.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
                At least one owner is required for loan applications. Add anyone
                who owns 20% or more of the business.
              </div>
            )}
          </>
        )}

        {currentContent === "loan" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Loan Request</h2>
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
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
                SBA loans are backed by the U.S. Small Business Administration. Your banker will
                determine specific program eligibility during underwriting.
              </div>
            )}
          </>
        )}

        {currentContent === "pfs" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Personal Financial Statement</h2>
            <p className="text-sm text-slate-500">
              SBA requires a personal financial statement from each owner with 20% or more
              equity. We&apos;ve pre-populated an entry for each owner you listed.
            </p>

            {pfsEntries.map((entry, eIdx) => (
              <div key={entry.owner_entity_id || eIdx} className="border border-slate-200 rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-semibold text-slate-800">{entry.owner_name || `Owner ${eIdx + 1}`}</h3>

                {/* Real Estate */}
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700 select-none">
                    Real Estate ({entry.real_estate.length})
                  </summary>
                  <div className="mt-2 space-y-3">
                    {entry.real_estate.map((re, rIdx) => (
                      <div key={re.id} className="grid grid-cols-2 gap-2 border border-slate-100 rounded p-3 relative">
                        <button type="button" onClick={() => setPfsEntries((prev) => prev.map((e, i) => i === eIdx ? { ...e, real_estate: e.real_estate.filter((_, j) => j !== rIdx) } : e))} className="absolute top-1 right-2 text-xs text-rose-400 hover:text-rose-600">x</button>
                        <div className="col-span-2">
                          <label className={labelCls}>Property Label</label>
                          <input className={inputCls} value={re.property_label} onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, real_estate: en.real_estate.map((r, j) => j === rIdx ? { ...r, property_label: e.target.value } : r) } : en))} placeholder="Primary residence" />
                        </div>
                        <div>
                          <label className={labelCls}>Type</label>
                          <select className={selectCls} value={re.property_type} onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, real_estate: en.real_estate.map((r, j) => j === rIdx ? { ...r, property_type: e.target.value } : r) } : en))}>
                            <option value="">Select...</option>
                            <option value="residential">Residential</option>
                            <option value="commercial">Commercial</option>
                            <option value="land">Land</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>Market Value ($)</label>
                          <input className={inputCls} value={re.present_market_value} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, real_estate: en.real_estate.map((r, j) => j === rIdx ? { ...r, present_market_value: e.target.value } : r) } : en))} placeholder="350,000" />
                        </div>
                        <div>
                          <label className={labelCls}>Mortgage Balance ($)</label>
                          <input className={inputCls} value={re.mortgage_balance} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, real_estate: en.real_estate.map((r, j) => j === rIdx ? { ...r, mortgage_balance: e.target.value } : r) } : en))} placeholder="200,000" />
                        </div>
                        <div>
                          <label className={labelCls}>Monthly Payment ($)</label>
                          <input className={inputCls} value={re.mortgage_payment} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, real_estate: en.real_estate.map((r, j) => j === rIdx ? { ...r, mortgage_payment: e.target.value } : r) } : en))} placeholder="1,500" />
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, real_estate: [...en.real_estate, { id: crypto.randomUUID(), property_label: "", property_type: "", present_market_value: "", mortgage_balance: "", mortgage_payment: "" }] } : en))} className="w-full py-2 rounded-lg border border-dashed border-slate-300 text-slate-500 text-xs hover:border-slate-400">+ Add Property</button>
                  </div>
                </details>

                {/* Securities */}
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700 select-none">
                    Stocks &amp; Bonds ({entry.securities.length})
                  </summary>
                  <div className="mt-2 space-y-3">
                    {entry.securities.map((sec, sIdx) => (
                      <div key={sec.id} className="grid grid-cols-3 gap-2 border border-slate-100 rounded p-3 relative">
                        <button type="button" onClick={() => setPfsEntries((prev) => prev.map((e, i) => i === eIdx ? { ...e, securities: e.securities.filter((_, j) => j !== sIdx) } : e))} className="absolute top-1 right-2 text-xs text-rose-400 hover:text-rose-600">x</button>
                        <div className="col-span-3">
                          <label className={labelCls}>Name of Securities</label>
                          <input className={inputCls} value={sec.name_of_securities} onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, securities: en.securities.map((s, j) => j === sIdx ? { ...s, name_of_securities: e.target.value } : s) } : en))} placeholder="Apple Inc (AAPL)" />
                        </div>
                        <div>
                          <label className={labelCls}># Shares</label>
                          <input className={inputCls} value={sec.number_of_shares} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, securities: en.securities.map((s, j) => j === sIdx ? { ...s, number_of_shares: e.target.value } : s) } : en))} placeholder="100" />
                        </div>
                        <div className="col-span-2">
                          <label className={labelCls}>Market Value ($)</label>
                          <input className={inputCls} value={sec.market_value} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, securities: en.securities.map((s, j) => j === sIdx ? { ...s, market_value: e.target.value } : s) } : en))} placeholder="15,000" />
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, securities: [...en.securities, { id: crypto.randomUUID(), name_of_securities: "", number_of_shares: "", market_value: "" }] } : en))} className="w-full py-2 rounded-lg border border-dashed border-slate-300 text-slate-500 text-xs hover:border-slate-400">+ Add Security</button>
                  </div>
                </details>

                {/* Notes Payable */}
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700 select-none">
                    Notes Payable ({entry.notes_payable.length})
                  </summary>
                  <div className="mt-2 space-y-3">
                    {entry.notes_payable.map((np, nIdx) => (
                      <div key={np.id} className="grid grid-cols-2 gap-2 border border-slate-100 rounded p-3 relative">
                        <button type="button" onClick={() => setPfsEntries((prev) => prev.map((e, i) => i === eIdx ? { ...e, notes_payable: e.notes_payable.filter((_, j) => j !== nIdx) } : e))} className="absolute top-1 right-2 text-xs text-rose-400 hover:text-rose-600">x</button>
                        <div className="col-span-2">
                          <label className={labelCls}>Noteholder Name</label>
                          <input className={inputCls} value={np.noteholder_name} onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, notes_payable: en.notes_payable.map((n, j) => j === nIdx ? { ...n, noteholder_name: e.target.value } : n) } : en))} placeholder="Wells Fargo" />
                        </div>
                        <div>
                          <label className={labelCls}>Original Balance ($)</label>
                          <input className={inputCls} value={np.original_balance} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, notes_payable: en.notes_payable.map((n, j) => j === nIdx ? { ...n, original_balance: e.target.value } : n) } : en))} placeholder="50,000" />
                        </div>
                        <div>
                          <label className={labelCls}>Current Balance ($)</label>
                          <input className={inputCls} value={np.current_balance} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, notes_payable: en.notes_payable.map((n, j) => j === nIdx ? { ...n, current_balance: e.target.value } : n) } : en))} placeholder="35,000" />
                        </div>
                        <div className="col-span-2">
                          <label className={labelCls}>Monthly Payment ($)</label>
                          <input className={inputCls} value={np.payment_amount} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, notes_payable: en.notes_payable.map((n, j) => j === nIdx ? { ...n, payment_amount: e.target.value } : n) } : en))} placeholder="500" />
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, notes_payable: [...en.notes_payable, { id: crypto.randomUUID(), noteholder_name: "", original_balance: "", current_balance: "", payment_amount: "" }] } : en))} className="w-full py-2 rounded-lg border border-dashed border-slate-300 text-slate-500 text-xs hover:border-slate-400">+ Add Note Payable</button>
                  </div>
                </details>

                {/* Totals */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className={labelCls}>Total Assets ($)</label>
                    <input className={inputCls} value={entry.total_assets} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, total_assets: e.target.value } : en))} placeholder="500,000" />
                  </div>
                  <div>
                    <label className={labelCls}>Total Liabilities ($)</label>
                    <input className={inputCls} value={entry.total_liabilities} inputMode="numeric" onChange={(e) => setPfsEntries((prev) => prev.map((en, i) => i === eIdx ? { ...en, total_liabilities: e.target.value } : en))} placeholder="200,000" />
                  </div>
                </div>
              </div>
            ))}

            {pfsEntries.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
                Go back to the Owners step and add at least one owner to generate personal financial statements.
              </div>
            )}
          </>
        )}

        {currentContent === "debt" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Existing Debt Schedule</h2>
            <p className="text-sm text-slate-500">
              List all outstanding business debts. If the business has no existing debt, check
              the box below.
            </p>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={debt.no_existing_debt}
                onChange={(e) => setDebt((d) => ({ ...d, no_existing_debt: e.target.checked, rows: e.target.checked ? [] : d.rows }))}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700">This business has no existing debt</span>
            </label>

            {!debt.no_existing_debt && (
              <>
                {debt.rows.map((row, rIdx) => (
                  <div key={row.id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-slate-600">Debt {rIdx + 1}</span>
                      <button type="button" onClick={() => setDebt((d) => ({ ...d, rows: d.rows.filter((_, j) => j !== rIdx) }))} className="text-xs text-rose-500 hover:text-rose-600">Remove</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className={labelCls}>Lender Name</label>
                        <input className={inputCls} value={row.lender_name} onChange={(e) => setDebt((d) => ({ ...d, rows: d.rows.map((r, j) => j === rIdx ? { ...r, lender_name: e.target.value } : r) }))} placeholder="Bank of America" />
                      </div>
                      <div>
                        <label className={labelCls}>Loan Type</label>
                        <select className={selectCls} value={row.loan_type} onChange={(e) => setDebt((d) => ({ ...d, rows: d.rows.map((r, j) => j === rIdx ? { ...r, loan_type: e.target.value } : r) }))}>
                          <option value="">Select...</option>
                          {DEBT_LOAN_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Current Balance ($)</label>
                        <input className={inputCls} value={row.current_balance} inputMode="numeric" onChange={(e) => setDebt((d) => ({ ...d, rows: d.rows.map((r, j) => j === rIdx ? { ...r, current_balance: e.target.value } : r) }))} placeholder="150,000" />
                      </div>
                      <div>
                        <label className={labelCls}>Monthly Payment ($)</label>
                        <input className={inputCls} value={row.monthly_payment} inputMode="numeric" onChange={(e) => setDebt((d) => ({ ...d, rows: d.rows.map((r, j) => j === rIdx ? { ...r, monthly_payment: e.target.value } : r) }))} placeholder="2,500" />
                      </div>
                      <div>
                        <label className={labelCls}>Maturity Date</label>
                        <input className={inputCls} type="date" value={row.maturity_date} onChange={(e) => setDebt((d) => ({ ...d, rows: d.rows.map((r, j) => j === rIdx ? { ...r, maturity_date: e.target.value } : r) }))} />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={row.is_being_refinanced}
                        onChange={(e) => setDebt((d) => ({ ...d, rows: d.rows.map((r, j) => j === rIdx ? { ...r, is_being_refinanced: e.target.checked } : r) }))}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">This debt will be refinanced by the new loan</span>
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setDebt((d) => ({ ...d, rows: [...d.rows, { id: crypto.randomUUID(), lender_name: "", loan_type: "", current_balance: "", monthly_payment: "", maturity_date: "", is_being_refinanced: false }] }))}
                  className="w-full py-3 rounded-lg border border-dashed border-slate-300 text-slate-500 text-sm hover:border-slate-400 hover:text-slate-600 transition min-h-[44px]"
                >
                  + Add Debt
                </button>
              </>
            )}
          </>
        )}

        {currentContent === "compliance" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">SBA Compliance Questions</h2>
            <p className="text-sm text-slate-500">
              The SBA requires every applicant to answer these questions (they mirror SBA Forms
              1919 and 912). Answer honestly — your banker will go over any &quot;yes&quot;
              answers with you before your application moves forward.
            </p>

            {COMPLIANCE_QUESTIONS.map((q) => (
              <div key={q.key} className="border border-slate-200 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium text-slate-800">{q.question}</p>
                {q.helper && <p className="text-xs text-slate-500">{q.helper}</p>}
                <div className="flex gap-3 pt-1">
                  {(["yes", "no"] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setCompliance((c) => ({ ...c, [q.key]: choice }))}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition min-h-[44px] ${
                        compliance[q.key] === choice
                          ? "brand-gradient-cta border-transparent text-white"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {choice === "yes" ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {currentContent === "projections" && (
          <AssumptionInterview
            token={token}
            dealId={dealId}
            onConfirmAndContinue={goNext}
          />
        )}

        {currentContent === "documents" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Upload Documents</h2>
            <p className="text-sm text-slate-500">
              Upload any financial documents you have available. Your banker
              will let you know if anything else is needed.
            </p>

            <PortalUploadDropzone
              token={token}
              dealId={dealId}
              onUploadComplete={() => setUploadCount((prev) => prev + 1)}
            />

            {uploadCount > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                <p className="text-sm text-emerald-700 font-medium">
                  {uploadCount} document{uploadCount !== 1 ? "s" : ""} uploaded so far
                </p>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
              Don&apos;t have everything right now? No problem — you can upload more
              documents after submitting your application. Your banker will send
              you a checklist of anything that&apos;s still needed.
            </div>
          </>
        )}

        {currentContent === "review" && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Review & Submit</h2>
            <div className="space-y-4 text-sm">
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Business</h3>
                <div className="space-y-1 text-slate-700">
                  <p><span className="text-slate-500">Legal Name:</span> {business.legal_name || "—"}</p>
                  {business.dba && <p><span className="text-slate-500">DBA:</span> {business.dba}</p>}
                  {business.ein && <p><span className="text-slate-500">EIN:</span> {business.ein}</p>}
                  {business.entity_type && <p><span className="text-slate-500">Type:</span> {business.entity_type}</p>}
                  {business.naics_code && <p><span className="text-slate-500">NAICS:</span> {business.naics_code}</p>}
                </div>
              </div>
              <div className="border-t border-slate-200 pt-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Address</h3>
                <div className="text-slate-700">
                  {address.address_line1 && <p>{address.address_line1}</p>}
                  <p>
                    {[address.city, address.state, address.zip].filter(Boolean).join(", ") || "—"}
                  </p>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Owners</h3>
                {owners.length === 0 ? (
                  <p className="text-slate-500 text-sm">No owners added</p>
                ) : (
                  <div className="space-y-1 text-slate-700">
                    {owners.map((o) => (
                      <p key={o.id}>
                        <span className="text-slate-500">{o.full_name || "—"}</span>
                        {o.ownership_pct && ` — ${o.ownership_pct}%`}
                        {o.title && ` (${o.title})`}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t border-slate-200 pt-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Loan</h3>
                <div className="space-y-1 text-slate-700">
                  {loan.type && <p><span className="text-slate-500">Type:</span> {LOAN_TYPE_OPTIONS.find(o => o.value === loan.type)?.label ?? loan.type}</p>}
                  {loan.amount && <p><span className="text-slate-500">Amount:</span> ${Number(loan.amount.replace(/[^0-9.]/g, "")).toLocaleString()}</p>}
                  {loan.purpose && <p><span className="text-slate-500">Purpose:</span> {loan.purpose}</p>}
                </div>
              </div>
              {isSba && (
                <div className="border-t border-slate-200 pt-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Personal Financial Statements</h3>
                  {pfsEntries.length === 0 ? (
                    <p className="text-slate-500 text-sm">No PFS entries added</p>
                  ) : (
                    <div className="space-y-1 text-slate-700">
                      {pfsEntries.map((e) => (
                        <p key={e.owner_entity_id}>
                          <span className="text-slate-500">{e.owner_name || "Unknown"}:</span>{" "}
                          {e.real_estate.length} properties, {e.securities.length} securities, {e.notes_payable.length} notes
                          {(e.total_assets || e.total_liabilities) && (
                            <span className="text-slate-400">
                              {" "}({e.total_assets ? `Assets: $${Number(e.total_assets.replace(/[^0-9.]/g, "")).toLocaleString()}` : ""}{e.total_assets && e.total_liabilities ? " / " : ""}{e.total_liabilities ? `Liabilities: $${Number(e.total_liabilities.replace(/[^0-9.]/g, "")).toLocaleString()}` : ""})
                            </span>
                          )}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {isSba && (
                <div className="border-t border-slate-200 pt-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Existing Debt</h3>
                  {debt.no_existing_debt ? (
                    <p className="text-slate-700 text-sm">No existing debt</p>
                  ) : debt.rows.length === 0 ? (
                    <p className="text-slate-500 text-sm">No debt entries added</p>
                  ) : (
                    <div className="space-y-1 text-slate-700">
                      {debt.rows.map((r) => (
                        <p key={r.id}>
                          <span className="text-slate-500">{r.lender_name || "—"}</span>
                          {r.current_balance && ` — $${Number(r.current_balance.replace(/[^0-9.]/g, "")).toLocaleString()}`}
                          {r.monthly_payment && ` ($${Number(r.monthly_payment.replace(/[^0-9.]/g, "")).toLocaleString()}/mo)`}
                          {r.is_being_refinanced && <span className="text-blue-600 text-xs ml-1">(refinancing)</span>}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {isSba && (
                <div className="border-t border-slate-200 pt-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    SBA Compliance
                  </h3>
                  <div className="space-y-1 text-slate-700">
                    {COMPLIANCE_QUESTIONS.map((q) => (
                      <p key={q.key}>
                        <span className="text-slate-500">{q.question}</span>{" "}
                        {compliance[q.key] === "yes" ? (
                          <span className="font-medium text-amber-700">Yes</span>
                        ) : compliance[q.key] === "no" ? (
                          <span className="font-medium text-slate-700">No</span>
                        ) : (
                          <span className="text-rose-500">Not answered</span>
                        )}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-slate-200 pt-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Documents</h3>
                <p className="text-slate-700 text-sm">
                  {uploadCount > 0
                    ? `${uploadCount} document${uploadCount !== 1 ? "s" : ""} uploaded`
                    : "No documents uploaded yet"}
                </p>
              </div>
              {isSba && (
                <div className="border-t border-slate-200 pt-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Identity Verification
                  </h3>
                  <IdentityVerificationPanel token={token} />
                </div>
              )}
              {isSba && (
                <div className="border-t border-slate-200 pt-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Approval Score
                  </h3>
                  <ApprovalScoreCard token={token} />
                </div>
              )}
              {isSba && (
                <div className="border-t border-slate-200 pt-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Your Business Plan
                  </h3>
                  <BorrowerPDFDownload token={token} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 1 && (
          <button
            onClick={goBack}
            className="flex-1 sm:flex-none px-6 py-3 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 transition min-h-[44px]"
          >
            Back
          </button>
        )}
        {step < TOTAL_STEPS ? (
          <button
            onClick={goNext}
            disabled={saving}
            className="brand-gradient-cta flex-1 px-6 py-3 rounded-lg text-white text-sm font-medium hover:brightness-110 transition disabled:opacity-50 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="brand-gradient-cta flex-1 px-6 py-3 rounded-lg text-white text-sm font-medium hover:brightness-110 transition disabled:opacity-50 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
          >
            {saving ? "Submitting…" : "Submit Application"}
          </button>
        )}
      </div>

      {/* Save indicator */}
      {saving && (
        <p className="text-center text-xs text-slate-400">Saving…</p>
      )}
    </div>
  );
}

// Phase 85-BPG-EXPERIENCE — Polls the portal-token PDF endpoint until the
// generated borrower business plan is ready, then renders a download button.
// The same POST endpoint both triggers generation and returns the signed URL,
// so re-posting is effectively a poll.
function BorrowerPDFDownload({ token }: { token: string }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 6;

    async function tryOnce() {
      attempts++;
      try {
        const res = await fetch(`/api/borrower/portal/${token}/generate-pdf`, {
          method: "POST",
        });
        const json = await res.json();
        if (cancelled) return;
        if (json?.ok && json.pdfUrl) {
          setPdfUrl(String(json.pdfUrl));
          setLoading(false);
          return;
        }
      } catch {
        // retry
      }
      if (attempts >= maxAttempts) {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
        return;
      }
      setTimeout(tryOnce, 5000);
    }

    tryOnce();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <div className="w-4 h-4 border-2 border-brand-blue-500 border-t-transparent rounded-full animate-spin" />
        Preparing your business plan…
      </div>
    );
  }

  if (failed || !pdfUrl) {
    return (
      <p className="text-sm text-slate-500">
        Business plan will be available after your banker reviews your application.
      </p>
    );
  }

  return (
    <a
      href={pdfUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="brand-gradient-cta inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium hover:brightness-110 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      Download Your Business Plan (PDF)
    </a>
  );
}
