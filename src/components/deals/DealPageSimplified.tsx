"use client";

import { useState, useEffect } from "react";
import { DealNarrator } from "@/components/deals/DealNarrator";
import { DealRemaining } from "@/components/deals/DealRemaining";
import { DealEvidence } from "@/components/deals/DealEvidence";
import { TimeSignal } from "@/components/deals/TimeSignal";
import { useSoftConfirmations } from "@/lib/ui/useSoftConfirmations";
import { SoftConfirmationStack } from "@/components/ui/SoftConfirmationStack";
import { deriveDealMode } from "@/lib/deals/deriveDealMode";
import type { DealMode } from "@/lib/deals/dealMode";

/**
 * HOLY CRAP UX - Example Integration
 * 
 * This shows the complete "Deal Narrator" experience.
 * 
 * Layout:
 * 1. DealNarrator (the voice of the system)
 * 2. What's Left (only if items pending)
 * 3. What's Been Received (evidence)
 * 
 * NO:
 * - Sidebars
 * - Tabs
 * - Cognitive branching
 * - Workflow steps
 * - "Run" buttons
 * 
 * JUST:
 * - A calm vertical story
 * - System explaining itself
 * - User watching it finish
 */
export function DealPageSimplified({ dealId }: { dealId: string }) {
  const confirm = useSoftConfirmations();
  const [dealMode, setDealMode] = useState<DealMode>("initializing");
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [receivedDocs, setReceivedDocs] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    async function loadDealState() {
      try {
        // Fetch checklist
        const checklistRes = await fetch(`/api/deals/${dealId}/checklist`);
        const checklistData = await checklistRes.json();

        // Fetch documents
        const docsRes = await fetch(`/api/deals/${dealId}/documents`);
        const docsData = await docsRes.json();

        if (checklistData.ok) {
          const pending = checklistData.pending || [];
          setPendingItems(pending);

          // Derive deal mode
          const mode = deriveDealMode({
            checklist: {
              state: checklistData.state || (pending.length === 0 ? "ready" : "needs_input"),
              pendingCount: pending.length,
            },
          });

          // Check for mode transition (ready)
          if (mode === "ready" && dealMode !== "ready") {
            confirm.push("Deal complete — nothing left to do 🎉");
          }

          setDealMode(mode);

          // Set detail for needs_input
          if (mode === "needs_input" && pending.length > 0) {
            const firstThree = pending.slice(0, 3).map((i: any) => i.title).join(", ");
            setDetail(pending.length > 3 ? `${firstThree}, and more` : firstThree);
          }
        }

        if (docsData.ok) {
          setReceivedDocs(docsData.documents || []);
        }

        setLastUpdated(new Date().toISOString());
      } catch (error) {
        console.error("[DealPageSimplified] Load error:", error);
      }
    }

    loadDealState();

    // Auto-refresh every 15s
    const interval = setInterval(loadDealState, 15000);
    return () => clearInterval(interval);
  }, [dealId]);

  return (
    <div className="mx-auto max-w-3xl p-6">
      {/* Soft confirmations */}
      <SoftConfirmationStack items={confirm.items} />

      {/* The Narrator - Single source of truth */}
      <div>
        <DealNarrator mode={dealMode} detail={detail || undefined} />
        <TimeSignal timestamp={lastUpdated} />
      </div>

      {/* What's Left (only if items pending) */}
      {pendingItems.length > 0 && (
        <DealRemaining items={pendingItems} />
      )}

      {/* What's Been Received (evidence) */}
      {receivedDocs.length > 0 && (
        <DealEvidence docs={receivedDocs} />
      )}

      {/* Empty state - calm, no anxiety */}
      {pendingItems.length === 0 && receivedDocs.length === 0 && dealMode === "initializing" && (
        <div className="mt-8 text-center text-sm text-slate-500">
          Upload documents to get started
        </div>
      )}
    </div>
  );
}
