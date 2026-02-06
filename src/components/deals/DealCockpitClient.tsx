"use client";

import { useState, useCallback, useEffect } from "react";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SafeBoundary } from "@/components/SafeBoundary";
import { LiveIndicator, ProcessingIndicator, CockpitToastStack } from "@/components/deals/LiveIndicator";
import { CockpitDataProvider } from "@/buddy/cockpit";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";
import { DegradedBanner } from "@/buddy/ui/DegradedBanner";
import { cn } from "@/lib/utils";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";
import type { LifecycleState } from "@/buddy/lifecycle/client";
import { getStageBadge } from "@/lib/lifecycle/stageBadge";
import { useDealMeta } from "@/hooks/useDealMeta";
import { deriveDealHeader } from "@/lib/deals/deriveDealHeader";

// Keystone Cockpit: 3-column layout
import { LeftColumn } from "@/components/deals/cockpit/columns/LeftColumn";
import { CenterColumn } from "@/components/deals/cockpit/columns/CenterColumn";
import { RightColumn } from "@/components/deals/cockpit/columns/RightColumn";
import { SecondaryTabsPanel } from "@/components/deals/cockpit/panels/SecondaryTabsPanel";
import { PipelineIndicator } from "@/components/deals/PipelineStatus";

// Glass panel style for Stitch-like design
const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";

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
const FORCE_CLIENT_ONLY = process.env.NEXT_PUBLIC_COCKPIT_CLIENT_ONLY === "true";

export default function DealCockpitClient({
  dealId,
  isAdmin = false,
  dealName,
  bankName,
  readiness: _readiness,
  lifecycleStage,
  ignitedEvent: _ignitedEvent,
  intakeInitialized,
  verify,
  verifyLedger,
  unifiedLifecycleState,
  lifecycleAvailable: _lifecycleAvailable = true,
}: {
  dealId: string;
  isAdmin?: boolean;
  dealName?: { displayName?: string | null; nickname?: string | null; borrowerName?: string | null; name?: string | null };
  bankName?: string | null;
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
  const { deal: dealMeta, refresh: refreshMeta, setDeal: setDealMeta } = useDealMeta(dealId);

  // Hydration-safe: defer render until mounted (env-gated)
  const [mounted, setMounted] = useState(!FORCE_CLIENT_ONLY);
  useEffect(() => { if (FORCE_CLIENT_ONLY) setMounted(true); }, []);

  // Rename state
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();

  React.useEffect(() => {
    setStage(lifecycleStage ?? null);
  }, [lifecycleStage]);

  // Backward compatibility: migrate old #hash anchors to ?tab= query params
  const HASH_TO_TAB: Record<string, string> = {
    "#setup": "setup",
    "#intake": "setup",
    "#borrower-request": "portal",
  };

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const tab = HASH_TO_TAB[hash];
    if (tab && !searchParams?.get("tab")) {
      router.replace(`/deals/${dealId}/cockpit?tab=${tab}`, { scroll: false });
    } else if (hash === "#documents") {
      // Scroll to document section for legacy #documents links
      requestAnimationFrame(() => {
        document.getElementById("cockpit-documents")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      // Clean the hash from the URL
      router.replace(`/deals/${dealId}/cockpit`, { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve header from fetched metadata (falls back to server props for SSR)
  const headerInput = dealMeta
    ? { display_name: dealMeta.display_name, name: dealMeta.name }
    : { display_name: dealName?.displayName ?? null, name: dealName?.name ?? null };
  const { title: resolvedDealTitle, needsName } = deriveDealHeader(dealId, headerInput);
  const isUntitled = needsName;
  const stageBadge = getStageBadge(stage);

  // Signal DB-authoritative name state
  const dbDisplayName = dealMeta?.display_name ?? dealName?.displayName ?? null;
  const dbName = dealMeta?.name ?? null;
  React.useEffect(() => {
    const hasName = Boolean((dbDisplayName ?? "").trim() || (dbName ?? "").trim());
    const action = hasName ? "deal.name.present" : "deal.name.missing";
    emitBuddySignal({
      type: "user.action",
      source: "components/deals/DealCockpitClient.tsx",
      dealId,
      payload: { action },
    });
  }, [dealId, dbDisplayName, dbName]);

  // Rename handlers
  const startRename = useCallback(() => {
    setDraftName(
      dealMeta?.display_name?.trim() || dealMeta?.name?.trim() || "",
    );
    setRenaming(true);
  }, [dealMeta]);

  const handleRenameSave = useCallback(async () => {
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: draftName.trim() || null }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        // Optimistic update
        if (dealMeta) {
          setDealMeta({ ...dealMeta, display_name: json.display_name ?? null });
        }
        setRenaming(false);
        // Also refresh to get full updated state
        refreshMeta();
      }
    } catch {
      // User can retry
    } finally {
      setRenameSaving(false);
    }
  }, [dealId, draftName, dealMeta, setDealMeta, refreshMeta]);

  // Hydration-safe gate: show skeleton until client mounts
  if (!mounted) {
    return (
      <div className="min-h-screen text-white flex items-center justify-center">
        <div className="animate-pulse text-white/30 text-sm">Loading cockpit...</div>
      </div>
    );
  }

  return (
    <CockpitDataProvider dealId={dealId} initialLifecycleState={unifiedLifecycleState}>
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
                    <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                      Deal Cockpit{bankName ? <span className="normal-case tracking-normal font-medium"> · {bankName}</span> : null}
                    </div>
                    {!renaming ? (
                      <div className="flex items-center gap-2">
                        <h1
                          id="deal-name"
                          className={cn(
                            "text-xl font-bold tracking-tight",
                            isUntitled ? "text-amber-300/80 italic" : "text-white",
                          )}
                        >
                          {resolvedDealTitle}
                        </h1>
                        {needsName && (
                          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                            Needs name
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={startRename}
                          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/60 hover:bg-white/10"
                        >
                          Rename
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          placeholder="Deal name"
                          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white w-64"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameSave();
                            if (e.key === "Escape") setRenaming(false);
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleRenameSave}
                          disabled={renameSaving}
                          className="rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                        >
                          {renameSaving ? "Saving\u2026" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenaming(false)}
                          className="rounded-lg border border-white/10 px-2 py-1 text-xs font-semibold text-white/70 hover:bg-white/5"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
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
            <div id="cockpit-documents" className="lg:col-span-4 order-3 lg:order-1">
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
