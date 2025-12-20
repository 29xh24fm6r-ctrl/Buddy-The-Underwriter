"use client";

import { useEffect, useState, useMemo } from "react";
import { computeNextBestAction } from "@/lib/ux/nextBestAction";
import type { DealSignals } from "@/lib/ux/nextBestAction";
import { useDealCommand } from "@/hooks/useDealCommand";
import { commandForNextAction } from "@/lib/deals/commands";
import Badge from "@/components/ux/Badge";

interface NextBestActionCardProps {
  dealId: string;
}

export default function NextBestActionCard({ dealId }: NextBestActionCardProps) {
  const [signals, setSignals] = useState<DealSignals | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchSignals = async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/signals`, { cache: "no-store" });
      const text = await res.text();

      if (!res.ok) {
        throw new Error(
          `GET /api/deals/${dealId}/signals → ${res.status} ${res.statusText}: ${text}`
        );
      }

      const data = JSON.parse(text);
      setSignals(data);
    } catch (e: any) {
      setErr(e?.message || "Failed to fetch signals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignals();
  }, [dealId]);

  const nextAction = useMemo(() => {
    if (!signals) return null;
    return computeNextBestAction(signals);
  }, [signals]);

  const runCommand = useDealCommand();

  const runCta = async () => {
    if (!nextAction) return;
    setBusy(true);
    try {
      // Execute command (opens modals, scrolls, updates URL)
      const cmd = commandForNextAction(nextAction.type);
      runCommand(cmd);

      // If action has API call, execute it
      if (nextAction.ctaAction) {
        const res = await fetch(nextAction.ctaAction, { method: "POST" });
        if (!res.ok) throw new Error("Action failed");
        // Re-fetch signals after API call
        await fetchSignals();
      }
    } catch (err) {
      console.error("CTA error:", err);
      setErr("Action failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-8 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-red-600 font-semibold mb-2">Error loading signals</p>
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {err}
        </div>
      </div>
    );
  }

  if (!nextAction || !signals) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-500">No action data available</p>
      </div>
    );
  }

  const severityStyles = {
    SUCCESS: "bg-green-50 border-green-200",
    WARNING: "bg-amber-50 border-amber-200",
    INFO: "bg-blue-50 border-blue-200",
  };

  const buttonStyles = {
    SUCCESS: "bg-green-600 hover:bg-green-700 text-white",
    WARNING: "bg-amber-600 hover:bg-amber-700 text-white",
    INFO: "bg-blue-600 hover:bg-blue-700 text-white",
  };

  // Build evidence chips
  const evidenceChips: string[] = [];
  if (!signals.hasUnderwriter) evidenceChips.push("No underwriter assigned");
  if (signals.failedJobs > 0) evidenceChips.push(`${signals.failedJobs} failed jobs`);
  if (signals.eligibleUploads - signals.ocrCompletedCount > 0) {
    evidenceChips.push(`${signals.eligibleUploads - signals.ocrCompletedCount} files not OCR'd`);
  }
  if (signals.draftMessages > 0) evidenceChips.push(`${signals.draftMessages} draft messages pending`);
  if (signals.conditionsCritical > 0) evidenceChips.push(`${signals.conditionsCritical} critical conditions`);
  if (signals.conditionsHigh > 0) evidenceChips.push(`${signals.conditionsHigh} high-priority conditions`);
  if (signals.formsReadyToGenerate > 0) evidenceChips.push(`${signals.formsReadyToGenerate} forms ready`);

  // Build "why this is next" bullets
  const whyBullets: string[] = [];
  if (nextAction.type === "ASSIGN_UNDERWRITER") {
    whyBullets.push("Ownership unlocks SLA tracking + queue routing");
    whyBullets.push("No other actions can proceed without an underwriter");
  } else if (nextAction.type === "RUN_WORKER_TICK") {
    whyBullets.push("Failed jobs block pipeline health");
    whyBullets.push("Worker will retry processing automatically");
  } else if (nextAction.type === "RUN_OCR_ALL") {
    whyBullets.push("This will auto-sort docs + update conditions");
    whyBullets.push("OCR extracts data for forms and insights");
  } else if (nextAction.type === "REVIEW_DRAFT_MESSAGES") {
    whyBullets.push("Approving sends + logs activity to borrower");
    whyBullets.push("Draft messages require human review before sending");
  } else if (nextAction.type === "REVIEW_CONDITIONS") {
    whyBullets.push("Critical/high conditions block closing");
    whyBullets.push("Resolve blockers to advance the deal");
  } else if (nextAction.type === "GENERATE_BANK_FORM") {
    whyBullets.push("Forms ready to generate speed up underwriting");
    whyBullets.push("Auto-filled from OCR data with review step");
  } else if (nextAction.type === "READY_TO_CLOSE") {
    whyBullets.push("All conditions satisfied!");
    whyBullets.push("Deal ready for final review and closing");
  }

  return (
    <div className={`rounded-lg border p-4 ${severityStyles[nextAction.severity]}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-sm">Next Best Action</h3>
            <Badge variant="info">Deterministic</Badge>
          </div>
          <p className="text-xs text-gray-600">System-recommended priority</p>
        </div>
      </div>

      {/* Action Title */}
      <div className="mb-3">
        <h4 className="font-semibold text-base mb-1">{nextAction.title}</h4>
        <p className="text-sm text-gray-700">{nextAction.subtitle}</p>
      </div>

      {/* CTA Button */}
      <button
        onClick={runCta}
        disabled={busy}
        className={`w-full py-2 px-4 rounded font-medium text-sm transition-colors mb-3 ${buttonStyles[nextAction.severity]} ${
          busy ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {busy ? "Processing..." : nextAction.ctaLabel}
      </button>

      {/* Evidence Chips */}
      {evidenceChips.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-gray-600 mb-2">Because:</p>
          <div className="flex flex-wrap gap-1.5">
            {evidenceChips.map((chip, idx) => (
              <span
                key={idx}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white border border-gray-300 text-gray-700"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Why This Is Next */}
      {whyBullets.length > 0 && (
        <div className="border-t border-gray-200 pt-3 mt-3">
          <p className="text-xs font-semibold text-gray-600 mb-2">Why this is next:</p>
          <ul className="space-y-1">
            {whyBullets.map((bullet, idx) => (
              <li key={idx} className="text-xs text-gray-700 flex items-start">
                <span className="mr-1.5">•</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Evidence Detail */}
      {nextAction.evidence && nextAction.evidence.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-medium">
            View evidence detail
          </summary>
          <ul className="mt-2 space-y-1 pl-4">
            {nextAction.evidence.map((ev: string, idx: number) => (
              <li key={idx} className="text-gray-600">
                • {ev}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
