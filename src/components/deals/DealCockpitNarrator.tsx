"use client";

import * as React from "react";
import { deriveDealMode } from "@/lib/deals/deriveDealMode";

type Props = {
  dealId: string;
};

export function DealCockpitNarrator({ dealId }: Props) {
  const [checklistState, setChecklistState] = React.useState<{
    state: "empty" | "ready";
    pendingCount: number;
  }>({ state: "empty", pendingCount: 0 });

  const [pipeline, setPipeline] = React.useState<{ status?: string }>({});
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

        // Fetch pipeline status
        const pipelineRes = await fetch(`/api/deals/${dealId}/pipeline`);
        if (pipelineRes.ok) {
          const pipelineData = await pipelineRes.json();
          if (pipelineData.ok) {
            setPipeline({ status: pipelineData.status });
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

  const derivedMode = deriveDealMode({
    checklistState: checklistState.state,
    pendingCount: checklistState.pendingCount,
    uploadsProcessingCount: uploads?.processing,
    pipelineStatus: pipeline?.status as any,
  });

  return (
    <div className="text-sm text-neutral-700">
      {derivedMode === "initializing" && "Preparing deal workspace…"}
      {derivedMode === "processing" && "Processing uploads and analysis…"}
      {derivedMode === "needs_input" && "Waiting on borrower input…"}
      {derivedMode === "ready" && "Deal is ready for decision."}
      {derivedMode === "blocked" && "Deal is blocked and needs attention."}
    </div>
  );
}
