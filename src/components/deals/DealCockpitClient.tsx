"use client";

import { useState, useCallback } from "react";
import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { DealCockpitNarrator } from "@/components/deals/DealCockpitNarrator";
import { DealCockpitInsights } from "@/components/deals/DealCockpitInsights";
import { DealOutputsPanel } from "@/components/deals/DealOutputsPanel";
import BorrowerAttachmentCard from "./BorrowerAttachmentCard";
import { DocumentClassificationInbox } from "@/components/deals/DocumentClassificationInbox";
import { LifecycleStatusPanel } from "@/components/deals/LifecycleStatusPanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";
import { useAnchorAutofocus } from "@/lib/deepLinks/useAnchorAutofocus";
import { cn } from "@/lib/utils";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";
// Import from client-safe module to avoid server-only code in client components
import type { LifecycleState } from "@/buddy/lifecycle/client";

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
 * Client wrapper for Deal Cockpit.
 * - Wires DealIntakeCard auto-seed → EnhancedChecklistCard refresh
 * - Shows live status bar to prove backend is responding during load
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
}) {
  const [stage, setStage] = useState<string | null>(lifecycleStage ?? null);
  const searchParams = useSearchParams();
  const optimisticName = (searchParams?.get("n") ?? "").trim();
  const [borrowerName, setBorrowerName] = useState<string | null>(
    dealName?.borrowerName ?? (optimisticName || null),
  );
  const [checklistRefresh, setChecklistRefresh] =
    useState<(() => Promise<void>) | null>(null);

  const ignitedLabel = React.useMemo(() => {
    const source = ignitedEvent?.source ?? null;
    if (!source) return null;
    if (source === "banker_invite" || source === "ignite") return "Intake started (Borrower invited)";
    if (source === "banker_upload") return "Intake started (Banker upload)";
    return "Intake started";
  }, [ignitedEvent?.source]);

  const highlightIntake = useAnchorAutofocus("intake");
  const highlightBorrower = useAnchorAutofocus("borrower-attach");
  const highlightDocuments = useAnchorAutofocus("documents");

  React.useEffect(() => {
    setBorrowerName(dealName?.borrowerName ?? (optimisticName || null));
    setStage(lifecycleStage ?? null);
  }, [dealName?.borrowerName, optimisticName, lifecycleStage]);

  // Invariant: deal display name should persist across create -> cockpit without flashing "NEEDS NAME".
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

  const readinessItems = [
    {
      key: "name",
      label: "Deal named",
      ok: readiness?.named ?? false,
      href: `/deals/${dealId}/cockpit?anchor=deal-name`,
      detail: null,
    },
    {
      key: "borrower",
      label: "Borrower attached",
      ok: readiness?.borrowerAttached ?? false,
      href: `/deals/${dealId}/cockpit?anchor=borrower-attach`,
      detail: null,
    },
    {
      key: "documents",
      label: "Required documents received",
      ok: readiness?.documentsReady ?? false,
      href: `/deals/${dealId}/cockpit?anchor=documents`,
      detail:
        readiness && readiness.requiredDocsCount > 0
          ? `${readiness.requiredDocsCount - readiness.missingDocsCount}/${readiness.requiredDocsCount}`
          : null,
    },
    {
      key: "financials",
      label: "Financial snapshot ready",
      ok: readiness?.financialSnapshotReady ?? false,
      href: `/deals/${dealId}/pricing`,
      detail: null,
    },
  ];

  // Resolve deal title: display_name > nickname > borrowerName > "Untitled deal"
  const resolvedDealTitle = dealName?.displayName?.trim() || dealName?.nickname?.trim() || effectiveBorrowerName || "Untitled deal";
  const isUntitled = resolvedDealTitle === "Untitled deal";

  // Stage badge styling
  const stageBadge = (() => {
    if (!stage || stage === "created") return { label: "New", className: "bg-slate-500/20 text-slate-300 border-slate-400/30" };
    if (stage === "intake" || stage === "ignited") return { label: "Intake", className: "bg-sky-500/20 text-sky-300 border-sky-400/30" };
    if (stage === "underwriting") return { label: "Underwriting", className: "bg-amber-500/20 text-amber-300 border-amber-400/30" };
    if (stage === "approved" || stage === "funded") return { label: stage, className: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30" };
    return { label: stage, className: "bg-white/10 text-white/70 border-white/20" };
  })();

  return (
    <div className="min-h-screen text-white">
      {/* Cockpit Container */}
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">

        {/* Hero Header - Strong hierarchy with deal title prominence */}
        <div className={cn(glassPanel, "overflow-hidden")}>
          <div className={glassHeader}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60">
                  <span className="material-symbols-outlined text-white text-[18px]">analytics</span>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Deal Cockpit</div>
                  <h1 id="deal-name" className={cn(
                    "text-xl font-bold tracking-tight scroll-mt-24",
                    isUntitled ? "text-amber-300/80 italic" : "text-white"
                  )}>
                    {resolvedDealTitle}
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                  stageBadge.className
                )}>
                  {stageBadge.label}
                </span>
                <PipelineIndicator dealId={dealId} />
              </div>
            </div>
          </div>

          {/* Readiness Status Bar */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/50">Readiness</span>
              {ignitedLabel && lifecycleStage !== "created" ? (
                <span className="text-xs text-white/40">{ignitedLabel}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {readinessItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    "group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all hover:scale-[1.02]",
                    item.ok
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                  )}
                >
                  <span className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                    item.ok ? "bg-emerald-500/30" : "bg-amber-500/30"
                  )}>
                    {item.ok ? "✓" : "!"}
                  </span>
                  <span>{item.label}</span>
                  {item.detail ? (
                    <span className="text-[10px] opacity-70 font-mono">{item.detail}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* System Narrator */}
        <DealCockpitNarrator dealId={dealId} />

        {/* Deal Health Insights */}
        <SafeBoundary>
          <DealCockpitInsights dealId={dealId} />
        </SafeBoundary>

        {/* Two Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left Column - Intake & Setup */}
          <div className="space-y-6">
            <div className={cn(glassPanel, "overflow-hidden")}>
              <div className={glassHeader}>
                <span className="text-xs font-bold uppercase tracking-widest text-white/50">Intake & Setup</span>
              </div>
              <div className="p-4 space-y-4">
                <SafeBoundary>
                  <div
                    id="intake"
                    className={cn(
                      "scroll-mt-24 rounded-xl transition",
                      highlightIntake && "ring-2 ring-sky-400/60 bg-sky-500/5",
                    )}
                  >
                    <DealIntakeCard
                      dealId={dealId}
                      onChecklistSeeded={handleChecklistSeeded}
                      isAdmin={isAdmin}
                      lifecycleStage={stage}
                      onLifecycleStageChange={setStage}
                    />
                  </div>
                </SafeBoundary>

                <SafeBoundary>
                  <div
                    id="borrower-attach"
                    className={cn(
                      "scroll-mt-24 rounded-xl transition",
                      highlightBorrower && "ring-2 ring-sky-400/60 bg-sky-500/5",
                    )}
                  >
                    <BorrowerAttachmentCard dealId={dealId} />
                  </div>
                </SafeBoundary>

                <SafeBoundary>
                  <div id="borrower-request" className="scroll-mt-24">
                    <BorrowerRequestComposerCard dealId={dealId} />
                  </div>
                </SafeBoundary>
              </div>
            </div>

            <div className={cn(glassPanel, "overflow-hidden")}>
              <div className={glassHeader}>
                <span className="text-xs font-bold uppercase tracking-widest text-white/50">Files & Documents</span>
              </div>
              <div className="p-4">
                <SafeBoundary>
                  <DealFilesCard dealId={dealId} />
                </SafeBoundary>
              </div>
            </div>

            {/* Document Classification - Magic Intake */}
            <SafeBoundary>
              <DocumentClassificationInbox dealId={dealId} />
            </SafeBoundary>
          </div>

          {/* Right Column - Underwriting & Progress */}
          <div className="space-y-6">
            {/* Unified Lifecycle Status */}
            <SafeBoundary>
              <LifecycleStatusPanel
                dealId={dealId}
                initialState={unifiedLifecycleState ?? null}
              />
            </SafeBoundary>

            {/* Deal Story Timeline */}
            <SafeBoundary>
              <DealStoryTimeline dealId={dealId} />
            </SafeBoundary>

            <div className={cn(glassPanel, "overflow-hidden")}>
              <div className={glassHeader}>
                <span className="text-xs font-bold uppercase tracking-widest text-white/50">Underwriting</span>
              </div>
              <div className="p-4 space-y-4">
                <SafeBoundary>
                  <UnderwritingControlPanel
                    dealId={dealId}
                    lifecycleStage={stage}
                    intakeInitialized={intakeInitialized}
                    verifyLedger={verifyLedger ?? null}
                  />
                </SafeBoundary>

                <SafeBoundary>
                  <DealOutputsPanel dealId={dealId} verify={verify} />
                </SafeBoundary>
              </div>
            </div>

            <div className={cn(glassPanel, "overflow-hidden")}>
              <div className={glassHeader}>
                <span className="text-xs font-bold uppercase tracking-widest text-white/50">Progress & Checklist</span>
              </div>
              <div className="p-4 space-y-4">
                <SafeBoundary>
                  <DealProgressWidget dealId={dealId} />
                </SafeBoundary>

                <SafeBoundary>
                  <div
                    id="documents"
                    className={cn(
                      "scroll-mt-24 rounded-xl transition",
                      highlightDocuments && "ring-2 ring-sky-400/60 bg-sky-500/5",
                    )}
                  >
                    <EnhancedChecklistCard
                      dealId={dealId}
                      onRefresh={handleChecklistRefresh}
                    />
                  </div>
                </SafeBoundary>
              </div>
            </div>

            <div className={cn(glassPanel, "overflow-hidden")}>
              <div className={glassHeader}>
                <span className="text-xs font-bold uppercase tracking-widest text-white/50">Borrower Portal</span>
              </div>
              <div className="p-4 space-y-4">
                <SafeBoundary>
                  <BorrowerUploadLinksCard dealId={dealId} lifecycleStage={stage} />
                </SafeBoundary>

                <SafeBoundary>
                  <UploadAuditCard dealId={dealId} />
                </SafeBoundary>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
