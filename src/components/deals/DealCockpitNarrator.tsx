"use client";

import * as React from "react";
import { deriveDealMode } from "@/lib/deals/deriveDealMode";
import { usePipelineState } from "@/lib/pipeline/usePipelineState";

type Props = {
  dealId: string;
};

export function DealCockpitNarrator({ dealId }: Props) {
  const { pipeline } = usePipelineState(dealId);
  
  const [checklistState, setChecklistState] = React.useState<{
    state: "empty" | "ready";
    pendingCount: number;
  }>({ state: "empty", pendingCount: 0 });

  const [uploads, setUploads] = React.useState<{ processing?: number }>({});

  React.useEffect(() => {
    const fetchState = async () => {
      try {
        // Fetch checklist state
        const checklistRes = await fetch(`/api/deals/${dealId}/checklist`);
        if (checklistRes.ok) {
          const checklistData = await checklistRes.json();
          if (checklistData.ok) {
            setChecklistState({
              state: checklistData.state || "ready",
              pendingCount: (checklistData.pending || []).length,
            });
          }
        }

        // Fetch uploads status
        const uploadsRes = await fetch(`/api/deals/${dealId}/uploads/status`);
        if (uploadsRes.ok) {
          const uploadsData = await uploadsRes.json();
          if (uploadsData.ok) {
            setUploads({ processing: uploadsData.processing || 0 });
          }
        }
      } catch (e) {
        console.error("Narrator state fetch error:", e);
      }
    };

    fetchState();
    const interval = setInterval(fetchState, 10000);
    return () => clearInterval(interval);
  }, [dealId]);

  // Use pipeline message if available, otherwise derive mode
  const message = pipeline.lastMessage || (() => {
    // Map pipeline ui_state to legacy pipelineStatus for deriveDealMode
    const legacyStatus = 
      pipeline.uiState === "working" ? "running" :
      pipeline.uiState === "waiting" ? "blocked" :
      "idle";

    const derivedMode = deriveDealMode({
      checklistState: checklistState.state,
      pendingCount: checklistState.pendingCount,
      uploadsProcessingCount: uploads?.processing,
      pipelineStatus: legacyStatus,
    });

    if (derivedMode === "initializing") return "Preparing deal workspace…";
    if (derivedMode === "processing") return "Processing uploads and analysis…";
    if (derivedMode === "needs_input") return "Waiting on borrower input…";
    if (derivedMode === "ready") return "Deal is ready for decision.";
    if (derivedMode === "blocked") return "Deal is blocked and needs attention.";
    return "Buddy is standing by…";
  })();

  return (
    <div className="text-sm text-neutral-700">
      {message}
    </div>
  );
}
