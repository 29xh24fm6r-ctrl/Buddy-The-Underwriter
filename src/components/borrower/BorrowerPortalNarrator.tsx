"use client";

import { useEffect, useState } from "react";
import { BorrowerNarrator } from "@/components/borrower/BorrowerNarrator";
import { deriveDealMode } from "@/lib/deals/deriveDealMode";
import type { DealMode } from "@/lib/deals/dealMode";
import { relativeTime } from "@/lib/ui/relativeTime";

type BorrowerPortalNarratorProps = {
  dealId: string;
  token?: string;
};

/**
 * Borrower-facing narrator for portal
 * Softer, calmer voice than banker version
 */
export function BorrowerPortalNarrator({ dealId, token }: BorrowerPortalNarratorProps) {
  const [mode, setMode] = useState<DealMode>("initializing");
  const [remainingCount, setRemainingCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  async function fetchState() {
    try {
      // Use token-based endpoint if available, otherwise regular API
      const endpoint = token 
        ? `/api/portal/${token}/checklist`
        : `/api/deals/${dealId}/checklist`;
      
      const checklistRes = await fetch(endpoint);
      const checklistData = await checklistRes.json();

      if (!checklistData.ok) {
        console.error("[BorrowerPortalNarrator] Failed to load checklist:", checklistData.error);
        return;
      }

      const pending = checklistData.items?.filter((item: any) => !item.is_satisfied) || [];
      const derivedMode = deriveDealMode({
        checklistState: checklistData.state || "empty",
        pendingCount: pending.length,
        uploadsProcessingCount: 0,
      });

      setMode(derivedMode);
      setRemainingCount(pending.length);
      setLastUpdate(new Date().toISOString());
    } catch (err) {
      console.error("[BorrowerPortalNarrator] Error fetching state:", err);
    }
  }

  useEffect(() => {
    fetchState();

    const interval = setInterval(fetchState, 30000); // Slower refresh for borrowers

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchState();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [dealId, token]);

  const rt = relativeTime(lastUpdate);

  return (
    <div className="space-y-2">
      <BorrowerNarrator mode={mode} remainingCount={remainingCount} />
      {rt && (
        <div className="text-xs text-neutral-500 px-5">
          {rt}
        </div>
      )}
    </div>
  );
}
