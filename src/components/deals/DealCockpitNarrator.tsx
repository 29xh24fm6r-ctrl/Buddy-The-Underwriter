"use client";

import * as React from "react";
import { usePipelineState } from "@/lib/pipeline/usePipelineState";
import { PIPELINE_COPY } from "@/lib/pipeline/pipelineCopy";
import { useShouldPoll } from "@/buddy/cockpit";

type Props = {
  dealId: string;
};

export function DealCockpitNarrator({ dealId }: Props) {
  const { pipeline } = usePipelineState(dealId);
  const { shouldPoll } = useShouldPoll();

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

    // Initial fetch
    fetchState();

    // Only poll if cockpit says we should (deal is busy)
    if (!shouldPoll) return;

    const interval = setInterval(fetchState, 5000); // 5s when busy
    return () => clearInterval(interval);
  }, [dealId, shouldPoll]);

  // Use pipeline message if available, otherwise use canonical copy
  const message = pipeline.lastMessage || PIPELINE_COPY[pipeline.uiState].long;

  return (
    <div className="text-sm text-neutral-700">
      {message}
    </div>
  );
}
