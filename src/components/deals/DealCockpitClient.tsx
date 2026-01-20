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
import { DealCockpitLoadingBar } from "@/components/deals/DealCockpitLoadingBar";
import { DealCockpitNarrator } from "@/components/deals/DealCockpitNarrator";
import { DealCockpitInsights } from "@/components/deals/DealCockpitInsights";
import { DealOutputsPanel } from "@/components/deals/DealOutputsPanel";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";
import BorrowerAttachmentCard from "./BorrowerAttachmentCard";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";
import { useAnchorAutofocus } from "@/lib/deepLinks/useAnchorAutofocus";
import { cn } from "@/lib/utils";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";

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
}) {
  const [displayName, setDisplayName] = useState<string | null>(dealName?.displayName ?? null);
  const [nickname, setNickname] = useState<string | null>(dealName?.nickname ?? null);
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

  const highlightDealName = useAnchorAutofocus("deal-name");
  const highlightIntake = useAnchorAutofocus("intake");
  const highlightBorrower = useAnchorAutofocus("borrower-attach");
  const highlightDocuments = useAnchorAutofocus("documents");

  React.useEffect(() => {
    setDisplayName(dealName?.displayName ?? null);
    setNickname(dealName?.nickname ?? null);
    setBorrowerName(dealName?.borrowerName ?? (optimisticName || null));
    setStage(lifecycleStage ?? null);
  }, [dealName?.displayName, dealName?.nickname, dealName?.borrowerName, optimisticName, lifecycleStage]);

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

  return (
    <div className="min-h-screen text-white">
      <DealCockpitLoadingBar dealId={dealId} />

      <div className="container mx-auto p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex w-fit items-center rounded-full bg-neutral-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
              Underwriting
            </div>
            <h1 className="text-3xl font-bold">Deal Cockpit</h1>
            {lifecycleStage && lifecycleStage !== "created" && ignitedLabel ? (
              <div className="text-xs text-white/60">{ignitedLabel}</div>
            ) : null}
            <div
              id="deal-name"
              className={cn(
                "scroll-mt-24 rounded-xl transition",
                highlightDealName && "ring-2 ring-sky-400/60 bg-sky-500/5",
              )}
            >
              <DealNameInlineEditor
                dealId={dealId}
                displayName={displayName}
                nickname={nickname}
                borrowerName={effectiveBorrowerName}
                size="md"
                tone="dark"
                onUpdated={(next) => {
                  setDisplayName(next.displayName ?? null);
                  setNickname(next.nickname ?? null);
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/deals/${dealId}/pricing`}
              className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-white/80 hover:border-white/20"
            >
              Risk Pricing
            </Link>
            <PipelineIndicator dealId={dealId} />
          </div>
        </div>

        {/* 🎙️ MAGIC NARRATOR - Calm, confident system voice */}
        <DealCockpitNarrator dealId={dealId} />

        <SafeBoundary>
          <DealCockpitInsights dealId={dealId} />
        </SafeBoundary>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/70">
            Readiness checklist
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {readinessItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  item.ok
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                    : "border-amber-400/40 bg-amber-400/10 text-amber-100"
                }`}
              >
                <span>{item.ok ? "✅" : "❌"}</span>
                <span>{item.label}</span>
                {item.detail ? <span className="text-[10px] opacity-80">{item.detail}</span> : null}
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
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

            <SafeBoundary>
              <DealFilesCard dealId={dealId} />
            </SafeBoundary>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            <SafeBoundary>
              <UnderwritingControlPanel
                dealId={dealId}
                lifecycleStage={stage}
                intakeInitialized={intakeInitialized}
              />
            </SafeBoundary>

            <SafeBoundary>
              <DealOutputsPanel dealId={dealId} verify={verify} />
            </SafeBoundary>

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
  );
}
