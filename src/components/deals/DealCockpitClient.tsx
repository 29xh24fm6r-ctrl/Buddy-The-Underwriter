"use client";

import { useState } from "react";
import React from "react";
import { useSearchParams } from "next/navigation";
import { SafeBoundary } from "@/components/SafeBoundary";
import { LiveIndicator, ProcessingIndicator, CockpitToastStack } from "@/components/deals/LiveIndicator";
import { CockpitDataProvider } from "@/buddy/cockpit";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";
import { DegradedBanner } from "@/buddy/ui/DegradedBanner";
import { cn } from "@/lib/utils";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";
import type { LifecycleState } from "@/buddy/lifecycle/client";
import { getStageBadge } from "@/lib/lifecycle/stageBadge";

// Keystone Cockpit: 3-column layout
import { LeftColumn } from "@/components/deals/cockpit/columns/LeftColumn";
import { CenterColumn } from "@/components/deals/cockpit/columns/CenterColumn";
import { RightColumn } from "@/components/deals/cockpit/columns/RightColumn";
import { SecondaryTabsPanel } from "@/components/deals/cockpit/panels/SecondaryTabsPanel";
import { PipelineIndicator } from "@/components/deals/PipelineStatus";

// Glass panel style for Stitch-like design
const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type UnderwriteVerifyLedgerEvent = {
  status: "pass" | "fail";
  source: "builder" | "runtime";
  details: {
    url: string;
    httpStatus?: number;
    auth?: boolean;
    html?: boolean;
    metaFallback?: boolean;
    error?: string;
    redacted?: boolean;
  };
  recommendedNextAction?: string | null;
  diagnostics?: Record<string, unknown> | null;
  createdAt?: string | null;
};

/**
 * Keystone Cockpit — 3-column flow controller.
 *
 * Layout:
 * - Left:   Documents + processing pipeline
 * - Center: Checklist (year-aware)
 * - Right:  Readiness, blockers, primary CTA
 *
 * Below: Secondary tabs for Setup, Portal, Underwriting, Timeline, Admin
 */
export default function DealCockpitClient({
  dealId,
  isAdmin = false,
  dealName,
  readiness,
  lifecycleStage,
  ignitedEvent,
  intakeInitialized,
  verify,
  verifyLedger,
  unifiedLifecycleState,
  lifecycleAvailable = true,
}: {
  dealId: string;
  isAdmin?: boolean;
  dealName?: { displayName?: string | null; nickname?: string | null; borrowerName?: string | null };
  readiness?: {
    named: boolean;
    borrowerAttached: boolean;
    documentsReady: boolean;
    financialSnapshotReady: boolean;
    requiredDocsCount: number;
    missingDocsCount: number;
  } | null;
  lifecycleStage?: string | null;
  ignitedEvent?: { source: string | null; createdAt: string | null } | null;
  intakeInitialized?: boolean;
  verify: VerifyUnderwriteResult;
  verifyLedger?: UnderwriteVerifyLedgerEvent | null;
  unifiedLifecycleState?: LifecycleState | null;
  lifecycleAvailable?: boolean;
}) {
  const [stage, setStage] = useState<string | null>(lifecycleStage ?? null);
  const searchParams = useSearchParams();
  const optimisticName = (searchParams?.get("n") ?? "").trim();
  const [borrowerName, setBorrowerName] = useState<string | null>(
    dealName?.borrowerName ?? (optimisticName || null),
  );

  React.useEffect(() => {
    setBorrowerName(dealName?.borrowerName ?? (optimisticName || null));
    setStage(lifecycleStage ?? null);
  }, [dealName?.borrowerName, optimisticName, lifecycleStage]);

  const effectiveBorrowerName = borrowerName || optimisticName || null;

  React.useEffect(() => {
    const action = effectiveBorrowerName ? "deal.name.present" : "deal.name.missing";
    emitBuddySignal({
      type: "user.action",
      source: "components/deals/DealCockpitClient.tsx",
      dealId,
      payload: { action },
    });
  }, [dealId, effectiveBorrowerName]);

  // Resolve deal title
  const resolvedDealTitle = dealName?.displayName?.trim() || dealName?.nickname?.trim() || effectiveBorrowerName || "Untitled deal";
  const isUntitled = resolvedDealTitle === "Untitled deal";
  const stageBadge = getStageBadge(stage);

  return (
    <CockpitDataProvider dealId={dealId}>
      {/* Builder Observer: Show degraded API responses */}
      <DegradedBanner dealId={dealId} />
      <div className="min-h-screen text-white">
        <div className="mx-auto max-w-[1600px] px-3 py-4 space-y-4 sm:px-6 sm:py-6 sm:space-y-6">

          {/* Hero Header — compact, focused */}
          <div className={cn(glassPanel, "overflow-hidden")}>
            <div className="px-5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60">
                    <span className="material-symbols-outlined text-white text-[18px]">analytics</span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Deal Cockpit</div>
                    <h1
                      id="deal-name"
                      className={cn(
                        "text-xl font-bold tracking-tight",
                        isUntitled ? "text-amber-300/80 italic" : "text-white",
                      )}
                    >
                      {resolvedDealTitle}
                    </h1>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <LiveIndicator />
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                      stageBadge.className,
                    )}
                  >
                    {stageBadge.label}
                  </span>
                  <PipelineIndicator dealId={dealId} />
                </div>
              </div>
            </div>
          </div>

          {/* Processing Micro-State */}
          <ProcessingIndicator />

          {/* === KEYSTONE 3-COLUMN LAYOUT === */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
            {/* Left Column: Documents + Pipeline (mobile: 3rd) */}
            <div className="lg:col-span-4 order-3 lg:order-1">
              <LeftColumn dealId={dealId} />
            </div>

            {/* Center Column: Year-Aware Checklist (mobile: 2nd) */}
            <div className="lg:col-span-4 order-2 lg:order-2">
              <CenterColumn dealId={dealId} />
            </div>

            {/* Right Column: Readiness + Primary CTA (mobile: 1st) */}
            <div className="lg:col-span-4 order-1 lg:order-3">
              <RightColumn dealId={dealId} isAdmin={isAdmin} />
            </div>
          </div>

          {/* === SECONDARY TABS === */}
          <SafeBoundary>
            <SecondaryTabsPanel
              dealId={dealId}
              isAdmin={isAdmin}
              lifecycleStage={stage}
              intakeInitialized={intakeInitialized}
              verify={verify}
              verifyLedger={verifyLedger}
              unifiedLifecycleState={unifiedLifecycleState}
              onLifecycleStageChange={setStage}
            />
          </SafeBoundary>
        </div>
      </div>

      {/* Toast Stack for "What Changed" notifications */}
      <CockpitToastStack />
    </CockpitDataProvider>
  );
}
