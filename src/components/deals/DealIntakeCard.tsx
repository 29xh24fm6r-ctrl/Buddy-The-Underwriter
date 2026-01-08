"use client";

import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { motion } from "framer-motion";
import { emitChecklistRefresh } from "@/lib/events/uiEvents";
import DealChecklistCard from "@/components/deals/DealChecklistCard";
import { cn } from "@/lib/utils";

type LoanType = "CRE" | "CRE_OWNER_OCCUPIED" | "CRE_INVESTOR" | "CRE_OWNER_OCCUPIED_WITH_RENT" | "LOC" | "TERM" | "SBA_7A" | "SBA_504";

type Intake = {
  loan_type: LoanType;
  sba_program: "7A" | "504" | null;
  borrower_name: string | null;
  borrower_email: string | null;
  borrower_phone: string | null;
};

type ReadinessState = {
  ok: boolean;
  expected: number;
  persisted: number;
  remaining: number;
  ready: boolean;
};

export type DealIntakeCardHandle = {
  startUploadBatch: (fileCount: number) => void;
  setOptimisticReady: () => void;
};

type DealIntakeCardProps = {
  dealId: string;
  onChecklistSeeded?: () => void | Promise<void>;
  isAdmin?: boolean;
};

const DealIntakeCard = forwardRef<DealIntakeCardHandle, DealIntakeCardProps>(({ 
  dealId,
  onChecklistSeeded,
  isAdmin = false,
}, ref) => {
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
  const [aiRecognizing, setAiRecognizing] = useState(false);
  const [showManualRecognition, setShowManualRecognition] = useState(false);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);
  const [partialMode, setPartialMode] = useState(false);
  
  // Readiness state (canonical)
  const [expectedUploads, setExpectedUploads] = useState(0);
  const [persistedUploads, setPersistedUploads] = useState(0);
  const [remainingUploads, setRemainingUploads] = useState(0);
  const [isReady, setIsReady] = useState(true);

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

  // Poll readiness endpoint
  async function pollReadiness() {
    if (!hasValidDealId) return;
    
    try {
      const res = await fetch(`/api/deals/${dealId}/uploads/readiness?expected=${expectedUploads}`);
      const json: ReadinessState = await res.json();
      
      if (json.ok) {
        setPersistedUploads(json.persisted);
        setRemainingUploads(json.remaining);
        setIsReady(json.ready);
        
        if (!json.ready) {
          console.log("[DealIntakeCard] Not ready:", json);
        }
      }
    } catch (e) {
      // Network error - assume ready (don't block on error)
      console.error("[DealIntakeCard] Readiness check failed:", e);
      setIsReady(true);
    }
  }

  // Start upload batch (called when user uploads files)
  function startUploadBatch(fileCount: number) {
    setExpectedUploads(fileCount);
    setPersistedUploads(0);
    setRemainingUploads(fileCount);
    setIsReady(false);
  }

  // Optimistic UI: immediately mark as ready
  function setOptimisticReady() {
    setIsReady(true);
    setRemainingUploads(0);
    setPersistedUploads(expectedUploads);
    emitChecklistRefresh(dealId);
  }

  // Expose imperative methods to parent
  useImperativeHandle(ref, () => ({
    startUploadBatch,
    setOptimisticReady,
  }), [expectedUploads, dealId]);

  // Poll while not ready
  useEffect(() => {
    if (isReady || !hasValidDealId) return;

    const interval = setInterval(pollReadiness, 1000); // 1s polling
    return () => clearInterval(interval);
  }, [isReady, hasValidDealId, expectedUploads]);

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
  
  async function save(autoSeed = true, forceOverride = false) {
    console.log("🚨 BUTTON CLICKED! save() function called with autoSeed:", autoSeed, "forceOverride:", forceOverride);
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

      // Step 2: Call auto-seed endpoint with query params
      if (autoSeed) {
        setAutoSeeding(true);
        
        // 🔥 OPTIMISTIC UI: Emit refresh immediately
        console.log("[DealIntakeCard] Emitting optimistic checklist refresh");
        emitChecklistRefresh(dealId);
        
        setMatchMessage(`✅ Intake saved. Seeding checklist for ${intake.loan_type}...`);
        
        console.log("[DealIntakeCard] Calling auto-seed endpoint...");
        
        // Build query params
        const params = new URLSearchParams();
        if (expectedUploads > 0) params.set("expected", expectedUploads.toString());
        if (partialMode) params.set("partial", "1");
        if (forceOverride) params.set("force", "1");
        // Do not mutate deal_documents rows from this button; it can trigger downstream doc processing.
        params.set("match", "0");
        
        const seedRes = await fetch(`/api/deals/${dealId}/auto-seed?${params}`, {
          method: "POST",
        });

        const seedJson = await seedRes.json();
        console.log("[DealIntakeCard] Auto-seed response:", seedJson);

        // Handle 403: admin required for force
        if (seedRes.status === 403) {
          setMatchMessage("❌ Admin privileges required for force override");
          setAutoSeeding(false);
          setSaving(false);
          return;
        }

        // Handle 409: uploads still processing
        if (seedRes.status === 409 && !forceOverride) {
          setMatchMessage(
            `⏳ Still processing ${seedJson.remaining || "some"} upload(s)\n\n` +
            `${isAdmin ? "As admin, you can force auto-seed using the override button below." : "Please wait for all uploads to finish."}\n` +
            `The checklist will auto-update when uploads complete.`
          );
          setAutoSeeding(false);
          setSaving(false);
          return;
        }

        if (seedJson.ok) {
          const summary = seedJson.checklist || {};
          const receivedTotal = typeof summary.received_total === "number" ? summary.received_total : null;
          const pendingTotal = typeof summary.pending_total === "number" ? summary.pending_total : null;
          const optionalTotal = typeof summary.optional_total === "number" ? summary.optional_total : null;
          setMatchMessage(
            `✅ Success!\n` +
            `• Loan type: ${intake.loan_type}\n` +
            `• Checklist items created: ${summary.seeded || 0}\n` +
            `• Files newly matched: ${summary.matched || 0}\n` +
            `${receivedTotal != null ? `• Checklist received (total): ${receivedTotal}\n` : ""}` +
            `${pendingTotal != null ? `• Checklist pending (total): ${pendingTotal}\n` : ""}` +
            `${optionalTotal != null ? `• Optional items (total): ${optionalTotal}\n` : ""}` +
            `${forceOverride ? "• Admin override used\n" : ""}` +
            `${partialMode ? "• Partial mode (matched docs only)\n" : ""}` +
            `\nRefreshing checklist…`
          );
          
          // 🔥 Emit checklist refresh event for auto-updates
          console.log("[DealIntakeCard] Emitting final checklist refresh event");
          emitChecklistRefresh(dealId);
          
          // 🔥 CRITICAL FIX: Trigger checklist refresh
          if (onChecklistSeeded) {
            console.log("[DealIntakeCard] Triggering checklist refresh callback");
            await onChecklistSeeded();
          }
        } else {
          setMatchMessage(
            `⚠️ Saved intake but auto-seed ${seedJson.status || "failed"}:\n${seedJson.error || seedJson.message || "Unknown error"}\n\nCheck browser console for details.`
          );
          console.error("[DealIntakeCard] Auto-seed failed:", seedJson);
        }
        setAutoSeeding(false);
      } else {
        // Intake saved without seeding; do not force-reload (avoids aborting in-flight API requests).
        emitChecklistRefresh(dealId);
        if (onChecklistSeeded) {
          await onChecklistSeeded();
        }
      }
    } catch (error: any) {
      console.error("[DealIntakeCard] Error during save:", error);
      setMatchMessage(`❌ Error: ${error?.message || "Unknown error"}\n\nCheck browser console for details.`);
    } finally {
      setSaving(false);
    }
  }

  async function runAiDocRecognition() {
    if (!hasValidDealId) return;
    setAiRecognizing(true);
    setMatchMessage("🧠 Running AI doc recognition (OCR + classify)…");
    try {
      const res = await fetch(`/api/deals/${dealId}/documents/intel/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setMatchMessage(
          `⚠️ Doc recognition failed:\n${json?.error || "Unknown error"}`,
        );
        return;
      }

      const processed = Number(json?.processed ?? 0) || 0;
      const stamped = Number(json?.stamped ?? 0) || 0;
      const analyzed = Number(json?.analyzed ?? 0) || 0;

      setMatchMessage(
        `✅ Doc recognition complete.\n` +
          `• Processed: ${processed}\n` +
          `• Stamped type/years: ${stamped}\n` +
          `• AI analyzed: ${analyzed}\n\n` +
          `Refreshing checklist…`,
      );

      emitChecklistRefresh(dealId);
      if (onChecklistSeeded) {
        await onChecklistSeeded();
      }
    } catch (e: any) {
      setMatchMessage(`❌ Doc recognition error: ${e?.message || String(e)}`);
    } finally {
      setAiRecognizing(false);
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
              : matchMessage.startsWith("⏳")
              ? "border-amber-800 bg-amber-950/40 text-amber-200"
              : "border-red-800 bg-red-950/40 text-red-200"
          }`}>
            {matchMessage}
          </div>
        )}

        {/* Animated upload progress bar */}
        {expectedUploads > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-neutral-400">
              <span>Upload Progress</span>
              <span>{persistedUploads} / {expectedUploads}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
              <motion.div
                className={cn(
                  "h-full rounded-full transition-colors",
                  isReady ? "bg-green-500" : "bg-blue-500"
                )}
                initial={{ width: 0 }}
                animate={{ 
                  width: expectedUploads > 0 
                    ? `${(persistedUploads / expectedUploads) * 100}%` 
                    : "0%"
                }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>
            {!isReady && (
              <p className="text-xs text-neutral-500">
                Uploading {remainingUploads} remaining file{remainingUploads !== 1 ? "s" : ""}...
              </p>
            )}
          </div>
        )}

        {/* Partial mode checkbox */}
        {expectedUploads > 0 && (
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={partialMode}
              onChange={(e) => setPartialMode(e.target.checked)}
              className="rounded border-neutral-700 bg-neutral-900"
            />
            <span>Partial mode (seed with incomplete uploads)</span>
          </label>
        )}

        <button
          type="submit"
          disabled={(!isReady && !partialMode) || saving || autoSeeding}
          className={cn(
            "w-full rounded-xl px-3 py-2 text-sm font-semibold transition-all",
            (!isReady && !partialMode) && "bg-gray-600 text-gray-300 cursor-not-allowed",
            isReady && !saving && !autoSeeding && "bg-green-600 hover:bg-green-700 text-white",
            (saving || autoSeeding) && "bg-blue-600 text-white cursor-wait animate-pulse"
          )}
          title={
            (!isReady && !partialMode)
              ? `Waiting for ${remainingUploads} upload(s) to finish`
              : (saving || autoSeeding)
              ? "Processing..."
              : "Ready to auto-seed checklist"
          }
        >
          {saving 
            ? "Saving intake..." 
            : autoSeeding 
            ? "Seeding checklist…" 
            : isReady 
            ? "Auto-Seed Checklist ✓" 
            : `Processing ${persistedUploads}/${expectedUploads}…`}
        </button>

        <button
          type="button"
          onClick={runAiDocRecognition}
          disabled={saving || autoSeeding || aiRecognizing}
          className={cn(
            "w-full rounded-xl px-3 py-2 text-sm font-semibold transition-all",
            (saving || autoSeeding || aiRecognizing)
              ? "bg-blue-600 text-white cursor-wait animate-pulse"
              : "bg-white text-neutral-900",
          )}
          title="Runs Azure OCR + (optional) OpenAI classification to detect doc type + years"
        >
          {aiRecognizing ? "Recognizing docs…" : "AI Doc Recognition"}
        </button>

        <button
          type="button"
          onClick={() => setShowManualRecognition((v) => !v)}
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-800"
        >
          {showManualRecognition ? "Hide Manual Doc Recognition" : "Manual Doc Recognition"}
        </button>

        {/* Admin override button */}
        {isAdmin && !isReady && (
          <button
            type="button"
            onClick={() => save(true, true)}
            disabled={saving || autoSeeding}
            className="w-full rounded-xl px-3 py-2 text-sm font-semibold bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
            title="Force auto-seed even with uploads processing (admin only)"
          >
            🔒 Admin Override: Force Seed
          </button>
        )}
      </form>

      {showManualRecognition ? (
        <div className="mt-4">
          <DealChecklistCard dealId={dealId} />
        </div>
      ) : null}
    </div>
  );
});

DealIntakeCard.displayName = "DealIntakeCard";

export default DealIntakeCard;
