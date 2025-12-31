"use client";

import { useState, useCallback } from "react";
import DealIntakeCard from "@/components/deals/DealIntakeCard";
import BorrowerRequestComposerCard from "@/components/deals/BorrowerRequestComposerCard";
import DealFilesCard from "@/components/deals/DealFilesCard";
import BorrowerUploadLinksCard from "@/components/deals/BorrowerUploadLinksCard";
import UploadAuditCard from "@/components/deals/UploadAuditCard";
import { DealProgressWidget } from "@/components/deals/DealProgressWidget";
import { EnhancedChecklistCard } from "@/components/deals/EnhancedChecklistCard";
import { UnderwritingControlPanel } from "@/components/deals/UnderwritingControlPanel";
import { SafeBoundary } from "@/components/SafeBoundary";
import { PipelineIndicator } from "@/components/deals/PipelineStatus";
import { DealCockpitLoadingBar } from "@/components/deals/DealCockpitLoadingBar";

/**
 * Client wrapper for Deal Cockpit.
 * - Wires DealIntakeCard auto-seed → EnhancedChecklistCard refresh
 * - Shows live status bar to prove backend is responding during load
 */
export default function DealCockpitClient({ dealId }: { dealId: string }) {
  const [checklistRefresh, setChecklistRefresh] =
    useState<(() => Promise<void>) | null>(null);

  // Checklist registers its refresh function
  const handleChecklistRefresh = useCallback((refreshFn: () => Promise<void>) => {
    setChecklistRefresh(() => refreshFn);
  }, []);

  // Intake triggers checklist refresh after seeding
  const handleChecklistSeeded = useCallback(async () => {
    if (checklistRefresh) {
      console.log("[DealCockpitClient] Refreshing checklist after auto-seed");
      await checklistRefresh();
    }
  }, [checklistRefresh]);

  return (
    <div className="min-h-screen">
      <DealCockpitLoadingBar dealId={dealId} />

      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Deal Cockpit</h1>
          <PipelineIndicator dealId={dealId} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            <SafeBoundary>
              <DealIntakeCard dealId={dealId} onChecklistSeeded={handleChecklistSeeded} />
            </SafeBoundary>
            <SafeBoundary>
              <BorrowerRequestComposerCard dealId={dealId} />
            </SafeBoundary>
            <SafeBoundary>
              <DealFilesCard dealId={dealId} />
            </SafeBoundary>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            <SafeBoundary>
              <UnderwritingControlPanel dealId={dealId} />
            </SafeBoundary>
            <SafeBoundary>
              <DealProgressWidget dealId={dealId} />
            </SafeBoundary>
            <SafeBoundary>
              <EnhancedChecklistCard dealId={dealId} onRefresh={handleChecklistRefresh} />
            </SafeBoundary>
            <SafeBoundary>
              <BorrowerUploadLinksCard dealId={dealId} />
            </SafeBoundary>
            <SafeBoundary>
              <UploadAuditCard dealId={dealId} />
            </SafeBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}
