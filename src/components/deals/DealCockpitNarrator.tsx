"use client";

import { useEffect, useState } from "react";
import { DealNarrator } from "@/components/deals/DealNarrator";
import { DealLedgerSnippet } from "@/components/deals/DealLedgerSnippet";
import { DealRemaining } from "@/components/deals/DealRemaining";
import { DealEvidence } from "@/components/deals/DealEvidence";
import { deriveDealMode } from "@/lib/deals/deriveDealMode";
import type { DealMode } from "@/lib/deals/dealMode";
import { SoftConfirmationStack } from "@/components/ui/SoftConfirmationStack";
import { useSoftConfirmations } from "@/lib/ui/useSoftConfirmations";

type DealCockpitNarratorProps = {
  dealId: string;
};

export function DealCockpitNarrator({ dealId }: DealCockpitNarratorProps) {
  const [mode, setMode] = useState<DealMode>("initializing");
  const [detail, setDetail] = useState<string | null>(null);
  const [remainingItems, setRemainingItems] = useState<Array<{ key: string; label: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; display_name: string }>>([]);
  const [latestEvent, setLatestEvent] = useState<any>(null);
  const [prevMode, setPrevMode] = useState<DealMode | null>(null);
  
  const confirmations = useSoftConfirmations();

  async function fetchState() {
    try {
      // Fetch checklist
      const checklistRes = await fetch(`/api/deals/${dealId}/checklist`);
      const checklistData = await checklistRes.json();

      if (!checklistData.ok) {
        console.error("[DealCockpitNarrator] Failed to load checklist:", checklistData.error);
        return;
      }

      // Fetch documents
      const docsRes = await fetch(`/api/deals/${dealId}/documents`);
      const docsData = await docsRes.json();

      if (docsData.ok) {
        setDocuments(docsData.documents || []);
      }

      // Fetch latest ledger event
      try {
        const ledgerRes = await fetch(`/api/deals/${dealId}/pipeline/latest`);
        const ledgerData = await ledgerRes.json();
        if (ledgerData.ok && ledgerData.event) {
          setLatestEvent(ledgerData.event);
        }
      } catch (e) {
        // Non-critical
      }

      // Derive mode
      const pending = checklistData.items?.filter((item: any) => !item.is_satisfied) || [];
      const derivedMode = deriveDealMode({
        checklistState: checklistData.state || "empty",
        pendingCount: pending.length,
        uploadsProcessingCount: 0, // TODO: wire upload processing count
        pipelineStatus: undefined, // TODO: wire pipeline status
      });

      // Build detail for needs_input
      let derivedDetail: string | null = null;
      if (derivedMode === "needs_input" && pending.length > 0 && pending.length <= 3) {
        derivedDetail = pending.map((p: any) => p.label).join(", ");
      }

      // Trigger soft confirmation on mode transitions
      if (prevMode !== null && prevMode !== "ready" && derivedMode === "ready") {
        confirmations.push("Deal complete — nothing left to do 🎉");
      }

      setPrevMode(derivedMode);
      setMode(derivedMode);
      setDetail(derivedDetail);
      setRemainingItems(pending.map((p: any) => ({ key: p.key, label: p.label })));
    } catch (err) {
      console.error("[DealCockpitNarrator] Error fetching state:", err);
    }
  }

  useEffect(() => {
    fetchState();

    // Auto-refresh every 15 seconds
    const interval = setInterval(fetchState, 15000);

    // Refresh on visibility change
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchState();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Listen for custom refresh events
    const handleCustomRefresh = () => {
      fetchState();
      confirmations.push("Checklist updated");
    };
    window.addEventListener("UI_EVENT_CHECKLIST_REFRESH", handleCustomRefresh);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("UI_EVENT_CHECKLIST_REFRESH", handleCustomRefresh);
    };
  }, [dealId]);

  return (
    <>
      <SoftConfirmationStack items={confirmations.items} />
      
      <div className="space-y-4">
        <DealNarrator mode={mode} detail={detail} />
        <DealLedgerSnippet latestEvent={latestEvent} />
        {mode === "needs_input" && <DealRemaining items={remainingItems} />}
        <DealEvidence docs={documents} />
      </div>
    </>
  );
}
