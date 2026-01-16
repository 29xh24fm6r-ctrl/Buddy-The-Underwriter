"use client";

import { useState, useCallback } from "react";
import React from "react";
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
import { DealCockpitNarrator } from "@/components/deals/DealCockpitNarrator";
import { DealCockpitInsights } from "@/components/deals/DealCockpitInsights";
import { DealOutputsPanel } from "@/components/deals/DealOutputsPanel";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";

/**
 * Client wrapper for Deal Cockpit.
 * - Wires DealIntakeCard auto-seed → EnhancedChecklistCard refresh
 * - Shows live status bar to prove backend is responding during load
 */
export default function DealCockpitClient({
  dealId,
  isAdmin = false,
  dealName,
}: {
  dealId: string;
  isAdmin?: boolean;
  dealName?: { displayName?: string | null; nickname?: string | null; borrowerName?: string | null };
}) {
  const [displayName, setDisplayName] = useState<string | null>(dealName?.displayName ?? null);
  const [nickname, setNickname] = useState<string | null>(dealName?.nickname ?? null);
  const [borrowerName, setBorrowerName] = useState<string | null>(dealName?.borrowerName ?? null);
  const [nameHydrated, setNameHydrated] = useState(false);
  const [checklistRefresh, setChecklistRefresh] =
    useState<(() => Promise<void>) | null>(null);

  // Checklist registers its refresh function
  const handleChecklistRefresh = useCallback((refreshFn: () => Promise<void>) => {
    setChecklistRefresh(() => refreshFn);
  }, []);

  // Intake triggers checklist refresh after seeding
  const handleChecklistSeeded = useCallback(async () => {
    if (!checklistRefresh) return;
    try {
      console.log("[DealCockpitClient] Refreshing checklist after auto-seed");
      // Allow state to settle (prevents rare latch/race)
      await new Promise((r) => setTimeout(r, 0));
      await checklistRefresh();
    } catch (e) {
      console.error("[DealCockpitClient] Checklist refresh failed:", e);
    }
  }, [checklistRefresh]);

  React.useEffect(() => {
    if (nameHydrated) return;
    let cancelled = false;
    fetch(`/api/deals/${dealId}/name`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.ok) return;
        setDisplayName(json.display_name ?? null);
        setNickname(json.nickname ?? null);
        setBorrowerName(json.borrower_name ?? null);
        setNameHydrated(true);
      })
      .catch(() => setNameHydrated(true));
    return () => {
      cancelled = true;
    };
  }, [dealId, nameHydrated]);

  return (
    <div className="min-h-screen">
      <DealCockpitLoadingBar dealId={dealId} />

      <div className="container mx-auto p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex w-fit items-center rounded-full bg-neutral-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
              Underwriting
            </div>
            <h1 className="text-3xl font-bold">Deal Cockpit</h1>
            <DealNameInlineEditor
              dealId={dealId}
              displayName={displayName}
              nickname={nickname}
              borrowerName={borrowerName}
              size="md"
              onUpdated={(next) => {
                setDisplayName(next.displayName ?? null);
                setNickname(next.nickname ?? null);
              }}
            />
          </div>
          <PipelineIndicator dealId={dealId} />
        </div>

        {/* 🎙️ MAGIC NARRATOR - Calm, confident system voice */}
        <DealCockpitNarrator dealId={dealId} />

        <SafeBoundary>
          <DealCockpitInsights dealId={dealId} />
        </SafeBoundary>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            <SafeBoundary>
              <DealIntakeCard
                dealId={dealId}
                onChecklistSeeded={handleChecklistSeeded}
                isAdmin={isAdmin}
              />
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
              <DealOutputsPanel dealId={dealId} />
            </SafeBoundary>

            <SafeBoundary>
              <DealProgressWidget dealId={dealId} />
            </SafeBoundary>

            <SafeBoundary>
              <EnhancedChecklistCard
                dealId={dealId}
                onRefresh={handleChecklistRefresh}
              />
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
