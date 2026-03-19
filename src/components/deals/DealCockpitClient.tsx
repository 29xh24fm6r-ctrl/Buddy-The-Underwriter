"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SafeBoundary } from "@/components/SafeBoundary";
import { CockpitToastStack } from "@/components/deals/LiveIndicator";
import { CockpitDataProvider } from "@/buddy/cockpit";
import { DegradedBanner } from "@/buddy/ui/DegradedBanner";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";
import type { LifecycleState } from "@/buddy/lifecycle/client";

import { StatusStrip } from "@/components/deals/cockpit/StatusStrip";
import { SecondaryTabsPanel } from "@/components/deals/cockpit/panels/SecondaryTabsPanel";

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

const FORCE_CLIENT_ONLY = process.env.NEXT_PUBLIC_COCKPIT_CLIENT_ONLY === "true";

type DealCockpitClientProps = {
  dealId: string;
  isAdmin?: boolean;
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
  gatekeeperPrimaryRouting?: boolean;
  intakePhase?: string | null;
  intakeGateEnabled?: boolean;
};

export default function DealCockpitClient(props: DealCockpitClientProps) {
  return <DealCockpitClientInner {...props} />;
}

function DealCockpitClientInner({
  dealId,
  isAdmin = false,
  readiness: _readiness,
  lifecycleStage,
  ignitedEvent: _ignitedEvent,
  intakeInitialized,
  verify,
  verifyLedger,
  unifiedLifecycleState,
  lifecycleAvailable: _lifecycleAvailable = true,
  gatekeeperPrimaryRouting = false,
  intakePhase,
  intakeGateEnabled = false,
}: DealCockpitClientProps) {
  const [stage, setStage] = useState<string | null>(lifecycleStage ?? null);

  // Hydration-safe: defer render until mounted (env-gated)
  const [mounted, setMounted] = useState(!FORCE_CLIENT_ONLY);
  useEffect(() => { if (FORCE_CLIENT_ONLY) setMounted(true); }, []);

  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
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
      router.replace(`/deals/${dealId}/cockpit?tab=documents`, { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

          {/* === STATUS STRIP === */}
          <SafeBoundary>
            <StatusStrip
              dealId={dealId}
              isAdmin={isAdmin}
              gatekeeperPrimaryRouting={gatekeeperPrimaryRouting}
              unifiedLifecycleState={unifiedLifecycleState}
              onAdvance={() => router.refresh()}
            />
          </SafeBoundary>

          {/* === SECONDARY TABS === */}
          <SafeBoundary>
            <SecondaryTabsPanel
              dealId={dealId}
              isAdmin={isAdmin}
              lifecycleStage={stage}
              intakeInitialized={intakeInitialized}
              intakePhase={intakePhase}
              intakeGateEnabled={intakeGateEnabled}
              verify={verify}
              verifyLedger={verifyLedger}
              unifiedLifecycleState={unifiedLifecycleState}
              onLifecycleStageChange={setStage}
              gatekeeperPrimaryRouting={gatekeeperPrimaryRouting}
            />
          </SafeBoundary>
        </div>
      </div>

      {/* Toast Stack for "What Changed" notifications */}
      <CockpitToastStack />
    </CockpitDataProvider>
  );
}
