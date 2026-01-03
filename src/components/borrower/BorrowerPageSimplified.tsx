/**
 * BorrowerPageSimplified — Complete borrower portal example
 * 
 * Structure (ALWAYS):
 * 1. BorrowerNarrator (calm voice)
 * 2. Upload Box (only if needs_input)
 * 3. Already Received (what we have)
 * 
 * NO:
 * - Checklist UI
 * - Status indicators
 * - Pipeline views
 * - Workflow steps
 * 
 * Borrowers never see HOW the system works.
 * Only WHAT's needed.
 */

"use client";

import { useEffect, useState } from "react";
import { BorrowerNarrator } from "./BorrowerNarrator";
import { BorrowerUploadBox } from "./BorrowerUploadBox";
import { BorrowerEvidence } from "./BorrowerEvidence";
import { DealMode } from "@/lib/deals/dealMode";
import { deriveDealMode } from "@/lib/deals/deriveDealMode";
import { TimeSignal } from "@/components/deals/TimeSignal";

interface BorrowerPageSimplifiedProps {
  dealId: string;
}

export function BorrowerPageSimplified({ dealId }: BorrowerPageSimplifiedProps) {
  const [mode, setMode] = useState<DealMode>("initializing");
  const [remainingCount, setRemainingCount] = useState(0);
  const [documents, setDocuments] = useState<any[]>([]);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const fetchState = async () => {
    try {
      // Fetch checklist
      const checklistRes = await fetch(`/api/deals/${dealId}/checklist`);
      const checklistData = await checklistRes.json();

      if (!checklistData.ok) {
        console.error("Failed to load checklist:", checklistData.error);
        return;
      }

      // Fetch documents
      const docsRes = await fetch(`/api/deals/${dealId}/documents`);
      const docsData = await docsRes.json();

      if (docsData.ok) {
        setDocuments(docsData.documents || []);
      }

      // Derive mode
      const derivedMode = deriveDealMode({
        checklistState: checklistData.state || "empty",
        pendingCount: checklistData.items?.filter((item: any) => !item.is_satisfied).length || 0,
        uploadsProcessingCount: 0, // Borrowers don't see processing details
      });

      setMode(derivedMode);
      setRemainingCount(
        checklistData.items?.filter((item: any) => !item.is_satisfied).length || 0
      );
      setLastUpdate(new Date());
    } catch (err) {
      console.error("Error fetching borrower state:", err);
    }
  };

  useEffect(() => {
    fetchState();

    // Auto-refresh every 15s
    const interval = setInterval(fetchState, 15000);

    // Refresh on visibility change
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
  }, [dealId]);

  const showUploadBox = mode === "needs_input" && remainingCount > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 px-6 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Time Signal */}
        <TimeSignal timestamp={lastUpdate.toISOString()} />

        {/* Narrator (ALWAYS VISIBLE) */}
        <BorrowerNarrator mode={mode} remainingCount={remainingCount} />

        {/* Upload Box (ONLY IF NEEDED) */}
        {showUploadBox && (
          <BorrowerUploadBox dealId={dealId} onUploadComplete={fetchState} />
        )}

        {/* Already Received */}
        <BorrowerEvidence documents={documents} />
      </div>
    </div>
  );
}
