"use client";

import { useState, useEffect } from "react";

type LoanType = "CRE" | "CRE_OWNER_OCCUPIED" | "CRE_INVESTOR" | "CRE_OWNER_OCCUPIED_WITH_RENT" | "LOC" | "TERM" | "SBA_7A" | "SBA_504";

type Intake = {
  loan_type: LoanType;
  sba_program: "7A" | "504" | null;
  borrower_name: string | null;
  borrower_email: string | null;
  borrower_phone: string | null;
};

export default function DealIntakeCard({ dealId }: { dealId: string }) {
  const [intake, setIntake] = useState<Intake>({
    loan_type: "CRE_OWNER_OCCUPIED",
    sba_program: null,
    borrower_name: null,
    borrower_email: null,
    borrower_phone: null,
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/intake/get`);
      const json = await res.json();
      if (json?.ok && json.intake) setIntake(json.intake);
      setLoading(false);
    }
    load();
  }, [dealId]);

  async function save(autoSeed = true) {
    setSaving(true);
    setMatchMessage(null);
    const res = await fetch(`/api/deals/${dealId}/intake/set`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        loanType: intake.loan_type,
        sbaProgram: intake.sba_program,
        borrowerName: intake.borrower_name,
        borrowerEmail: intake.borrower_email,
        borrowerPhone: intake.borrower_phone,
        autoSeed,
      }),
    });
    const json = await res.json();
    setSaving(false);
    
    // Show auto-match results if any
    if (json?.matchResult?.updated > 0) {
      setMatchMessage(`✅ Automatically matched ${json.matchResult.updated} uploaded documents to checklist items!`);
    }
    
    window.location.reload(); // refresh to show new checklist
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
        <div className="text-base font-semibold text-neutral-50">Deal Intake</div>
        <div className="mt-2 text-sm text-neutral-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
      <div className="text-base font-semibold text-neutral-50">Deal Intake</div>
      <div className="mt-1 text-sm text-neutral-400">Set loan type to auto-generate checklist presets</div>

      <div className="mt-4 space-y-3">
        {matchMessage && (
          <div className="rounded-xl border border-green-800 bg-green-950/20 p-3 text-sm text-green-200">
            {matchMessage}
          </div>
        )}
        
        <div>
          <label className="text-xs text-neutral-400">Loan Type</label>
          <select
            value={intake.loan_type}
            onChange={(e) => setIntake({ ...intake, loan_type: e.target.value as LoanType })}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
          >
            <optgroup label="Commercial Real Estate (CRE)">
              <option value="CRE_OWNER_OCCUPIED">CRE - Owner Occupied</option>
              <option value="CRE_INVESTOR">CRE - Investor (Rental Property)</option>
              <option value="CRE_OWNER_OCCUPIED_WITH_RENT">CRE - Owner Occupied with Rent (&lt;49% leased)</option>
            </optgroup>
            <optgroup label="Other Loan Types">
              <option value="LOC">LOC (Line of Credit)</option>
              <option value="TERM">TERM (Term Loan)</option>
              <option value="SBA_7A">SBA 7(a)</option>
              <option value="SBA_504">SBA 504</option>
            </optgroup>
          </select>
        </div>

        <div>
          <label className="text-xs text-neutral-400">Borrower Name</label>
          <input
            value={intake.borrower_name || ""}
            onChange={(e) => setIntake({ ...intake, borrower_name: e.target.value })}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Optional"
          />
        </div>

        <div>
          <label className="text-xs text-neutral-400">Borrower Email</label>
          <input
            value={intake.borrower_email || ""}
            onChange={(e) => setIntake({ ...intake, borrower_email: e.target.value })}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Optional"
          />
        </div>

        <div>
          <label className="text-xs text-neutral-400">Borrower Phone</label>
          <input
            value={intake.borrower_phone || ""}
            onChange={(e) => setIntake({ ...intake, borrower_phone: e.target.value })}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Optional"
          />
        </div>

        <button
          onClick={() => save(true)}
          disabled={saving}
          className="w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save + Auto-Seed Checklist"}
        </button>
      </div>
    </div>
  );
}
