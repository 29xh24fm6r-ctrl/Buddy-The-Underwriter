"use client";

import { useState, useEffect } from "react";
import { emitChecklistRefresh } from "@/lib/events/uiEvents";

type LoanType = "CRE" | "CRE_OWNER_OCCUPIED" | "CRE_INVESTOR" | "CRE_OWNER_OCCUPIED_WITH_RENT" | "LOC" | "TERM" | "SBA_7A" | "SBA_504";

type Intake = {
  loan_type: LoanType;
  sba_program: "7A" | "504" | null;
  borrower_name: string | null;
  borrower_email: string | null;
  borrower_phone: string | null;
};

export default function DealIntakeCard({ 
  dealId,
  onChecklistSeeded,
}: { 
  dealId: string;
  onChecklistSeeded?: () => void | Promise<void>;
}) {
  const [intake, setIntake] = useState<Intake>({
    loan_type: "CRE_OWNER_OCCUPIED",
    sba_program: null,
    borrower_name: null,
    borrower_email: null,
    borrower_phone: null,
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSeeding, setAutoSeeding] = useState(false);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);

  // Never call APIs with a missing/invalid dealId (prevents uuid "undefined" errors).
  const hasValidDealId = dealId && dealId !== "undefined";

  useEffect(() => {
    if (!hasValidDealId) return;
    
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/intake/get`);
      const json = await res.json();
      if (json?.ok && json.intake) setIntake(json.intake);
      setLoading(false);
    }
    load();
  }, [dealId, hasValidDealId]);

  if (!hasValidDealId) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[DealIntakeCard] invalid dealId prop:", dealId);
    }
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
        <div className="text-base font-semibold text-neutral-50">Deal Intake</div>
        <div className="mt-2 text-sm text-neutral-400">
          Deal context is still loading. Refresh the page if this persists.
        </div>
        <button
          type="button"
          disabled
          className="mt-4 w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-neutral-200 opacity-60 cursor-not-allowed"
        >
          Save + Auto-Seed Checklist
        </button>
      </div>
    );
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("🔴 DealIntakeCard MOUNTED - dealId:", dealId);
  }
  
  async function save(autoSeed = true) {
    console.log("🚨 BUTTON CLICKED! save() function called with autoSeed:", autoSeed);
    setSaving(true);
    setMatchMessage(null);
    
    try {
      console.log("[DealIntakeCard] Saving intake with loan_type:", intake.loan_type);
      
      // Step 1: Save intake
      const res = await fetch(`/api/deals/${dealId}/intake/set`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loanType: intake.loan_type,
          sbaProgram: intake.sba_program,
          borrowerName: intake.borrower_name,
          borrowerEmail: intake.borrower_email,
          borrowerPhone: intake.borrower_phone,
          autoSeed: false, // Don't auto-seed in this endpoint
        }),
      });
      
      const json = await res.json();
      console.log("[DealIntakeCard] Intake save response:", json);
      
      if (!res.ok || !json?.ok) {
        setMatchMessage(`❌ Failed to save intake: ${json?.error || "Unknown error"}`);
        setSaving(false);
        return;
      }

      setMatchMessage(`✅ Intake saved (loan type: ${intake.loan_type})`);

      // Step 2: Call auto-seed endpoint
      if (autoSeed) {
        setAutoSeeding(true);
        setMatchMessage(`✅ Intake saved. Auto-seeding checklist for ${intake.loan_type}...`);
        
        console.log("[DealIntakeCard] Calling auto-seed endpoint...");
        const seedRes = await fetch(`/api/deals/${dealId}/auto-seed`, {
          method: "POST",
        });

        const seedJson = await seedRes.json();
        console.log("[DealIntakeCard] Auto-seed response:", seedJson);

        // Handle 409: uploads still processing
        if (seedRes.status === 409) {
          setMatchMessage(
            `⏳ Still processing ${seedJson.remaining || "some"} upload(s)\n\n` +
            `Please wait for all uploads to finish before auto-seeding.\n` +
            `The checklist will auto-update when uploads complete.`
          );
          setAutoSeeding(false);
          return;
        }

        if (seedJson.ok) {
          const summary = seedJson.checklist || {};
          setMatchMessage(
            `✅ Success!\n` +
            `• Loan type: ${intake.loan_type}\n` +
            `• Checklist items created: ${summary.seeded || 0}\n` +
            `• Files matched: ${summary.matched || 0}\n` +
            `\nRefreshing page in 2 seconds...`
          );
          
          // 🔥 Emit checklist refresh event for auto-updates
          console.log("[DealIntakeCard] Emitting checklist refresh event");
          emitChecklistRefresh(dealId);
          
          // 🔥 CRITICAL FIX: Trigger checklist refresh
          if (onChecklistSeeded) {
            console.log("[DealIntakeCard] Triggering checklist refresh callback");
            await onChecklistSeeded();
          }
          
          // Refresh after delay to show updates
          setTimeout(() => {
            console.log("[DealIntakeCard] Reloading page...");
            window.location.reload();
          }, 2000);
        } else {
          setMatchMessage(
            `⚠️ Saved intake but auto-seed ${seedJson.status || "failed"}:\n${seedJson.error || seedJson.message || "Unknown error"}\n\nCheck browser console for details.`
          );
          console.error("[DealIntakeCard] Auto-seed failed:", seedJson);
        }
        setAutoSeeding(false);
      } else {
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (error: any) {
      console.error("[DealIntakeCard] Error during save:", error);
      setMatchMessage(`❌ Error: ${error?.message || "Unknown error"}\n\nCheck browser console for details.`);
    } finally {
      setSaving(false);
    }
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

      <form
        className="mt-4 space-y-3"
        method="post"
        action={`/deals/${dealId}/cockpit/seed`}
        onSubmit={(e) => {
          // If JS is working, keep the snappy fetch-based flow.
          // If hydration is broken, this handler won't attach and the POST still works.
          e.preventDefault();
          void save(true);
        }}
      >
        <div>
          <label className="text-xs text-neutral-400">Loan Type</label>
          <select
            name="loanType"
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
            name="borrowerName"
            value={intake.borrower_name || ""}
            onChange={(e) => setIntake({ ...intake, borrower_name: e.target.value })}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Optional"
          />
        </div>

        <div>
          <label className="text-xs text-neutral-400">Borrower Email</label>
          <input
            name="borrowerEmail"
            value={intake.borrower_email || ""}
            onChange={(e) => setIntake({ ...intake, borrower_email: e.target.value })}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Optional"
          />
        </div>

        <div>
          <label className="text-xs text-neutral-400">Borrower Phone</label>
          <input
            name="borrowerPhone"
            value={intake.borrower_phone || ""}
            onChange={(e) => setIntake({ ...intake, borrower_phone: e.target.value })}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Optional"
          />
        </div>

        {matchMessage && (
          <div className={`rounded-xl border p-3 text-sm whitespace-pre-line ${
            matchMessage.startsWith("✅") 
              ? "border-emerald-800 bg-emerald-950/40 text-emerald-200" 
              : matchMessage.startsWith("⚠️")
              ? "border-amber-800 bg-amber-950/40 text-amber-200"
              : "border-red-800 bg-red-950/40 text-red-200"
          }`}>
            {matchMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || autoSeeding}
          className="w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50 hover:bg-neutral-100 transition-colors"
        >
          {saving ? "Saving intake..." : autoSeeding ? "Auto-seeding checklist..." : "Save + Auto-Seed Checklist"}
        </button>
      </form>
    </div>
  );
}
