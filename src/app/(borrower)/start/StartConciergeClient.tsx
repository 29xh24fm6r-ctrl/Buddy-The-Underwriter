"use client";

import { useCallback, useEffect, useState } from "react";
import { BorrowerWorkspaceGate, type VerifiedSession } from "@/components/brokerage/BorrowerWorkspaceGate";
import {
  type JourneyStatusInput,
  type MarketplaceListingStatus,
} from "@/components/brokerage/BrokerageStageStrip";
import { GuidedIntakeShell } from "@/components/borrower/intake/GuidedIntakeShell";
import { IntakePurposeStep } from "@/components/borrower/intake/IntakePurposeStep";
import { IntakeBusinessStep } from "@/components/borrower/intake/IntakeBusinessStep";
import { IntakeOwnershipStep } from "@/components/borrower/intake/IntakeOwnershipStep";
import { IntakeFinancialsStep } from "@/components/borrower/intake/IntakeFinancialsStep";
import { IntakeReviewStep } from "@/components/borrower/intake/IntakeReviewStep";
import { FloatingConcierge } from "@/components/borrower/intake/FloatingConcierge";
import { PostSubmitHub } from "@/components/borrower/intake/PostSubmitHub";
import { BORROWER_FIELD_REGISTRY } from "@/lib/sba/forms/borrowerFieldRegistry";
import type { FieldProgress } from "@/lib/sba/forms/borrowerFieldProgress";
import type { DealVerificationState } from "@/components/borrower/intake/IntakeReviewStep";

const JOURNEY_POLL_MS = 20_000;
const VOICE_TURN_REFRESH_DELAY_MS = 2_500;

const BOOTSTRAP_STEP_LABELS: Record<string, string> = {
  "borrower.first_name": "your name",
  "borrower.email": "your email",
  "business.legal_name_or_industry": "your business",
  "loan.amount_requested": "how much you're financing",
  "loan.use_of_proceeds": "what the money is for",
  "business.is_franchise": "whether you're financing a franchise",
};

const REGISTRY_LABEL_BY_FACT_PATH: Record<string, string> = Object.fromEntries(
  BORROWER_FIELD_REGISTRY.map((entry) => [entry.factPath, entry.label]),
);

function labelForNextStep(field: string): string {
  return BOOTSTRAP_STEP_LABELS[field] ?? REGISTRY_LABEL_BY_FACT_PATH[field] ?? field;
}

export function describeNextSteps(fields: string[]): string | null {
  if (fields.length === 0) return null;
  const labels = fields.map(labelForNextStep);
  if (labels.length === 1) return `One thing left: ${labels[0]}.`;
  const last = labels[labels.length - 1];
  const rest = labels.slice(0, -1).join(", ");
  return `${labels.length} things left: ${rest} and ${last}.`;
}

function deriveVerifications(counts: {
  identityVerificationCount: number;
  ownershipEntityCount: number;
  documentsUploadedCount: number;
}): DealVerificationState {
  return {
    entityResolved: counts.ownershipEntityCount >= 1,
    identityVerified: counts.identityVerificationCount >= 1,
    financialsExtracted: counts.documentsUploadedCount > 0,
  };
}

function chapterFromFieldProgress(
  fieldProgress: FieldProgress | null,
  sealed: boolean,
): 1 | 2 | 3 | 4 | 5 {
  if (sealed) return 5;
  if (!fieldProgress || !fieldProgress.determinable) return 1;
  const bc = fieldProgress.byChapter;
  for (const ch of [1, 2, 3, 4, 5] as const) {
    const c = bc[ch];
    if (c.total > 0 && c.complete < c.total) return ch;
  }
  return 5;
}

type ExtendedJourneyStatus = JourneyStatusInput & {
  fieldProgress: FieldProgress | null;
  gateReasons: string[];
  identityVerificationCount: number;
  ownershipEntityCount: number;
  refreshSoon: () => void;
};

function useJourneyStatus(dealId: string | null): ExtendedJourneyStatus {
  const [status, setStatus] = useState<JourneyStatusInput & { fieldProgress: FieldProgress | null; gateReasons: string[]; identityVerificationCount: number; ownershipEntityCount: number }>({
    hasDealId: false,
    progressPct: 0,
    documentsUploadedCount: 0,
    sealed: false,
    listingStatus: null,
    matchedLenderCount: 0,
    claimsCount: 0,
    fieldProgress: null,
    gateReasons: [],
    identityVerificationCount: 0,
    ownershipEntityCount: 0,
  });

  const refresh = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/brokerage/deals/${id}/seal-status`);
        const json = await res.json();
        if (!json?.ok) return;
        setStatus({
          hasDealId: true,
          progressPct: json.fieldProgress?.determinable && json.fieldProgress.requiredTotal > 0
            ? Math.round((json.fieldProgress.completedCount / json.fieldProgress.requiredTotal) * 100)
            : 0,
          documentsUploadedCount: typeof json.documentsUploadedCount === "number" ? json.documentsUploadedCount : 0,
          sealed: Boolean(json.sealed),
          listingStatus: (json.listing?.status as MarketplaceListingStatus | undefined) ?? null,
          matchedLenderCount: json.listing?.matchedLenderCount ?? 0,
          claimsCount: Array.isArray(json.claims) ? json.claims.length : 0,
          fieldProgress: json.fieldProgress ?? null,
          gateReasons: Array.isArray(json.gateReasons) ? json.gateReasons : [],
          identityVerificationCount: typeof json.identityVerificationCount === "number" ? json.identityVerificationCount : 0,
          ownershipEntityCount: typeof json.ownershipEntityCount === "number" ? json.ownershipEntityCount : 0,
        });
      } catch {
        // non-fatal
      }
    },
    [],
  );

  useEffect(() => {
    if (!dealId) return;
    void refresh(dealId);
    const timer = window.setInterval(() => void refresh(dealId), JOURNEY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [dealId, refresh]);

  const refreshSoon = useCallback(() => {
    if (!dealId) return;
    window.setTimeout(() => void refresh(dealId), VOICE_TURN_REFRESH_DELAY_MS);
  }, [dealId, refresh]);

  return { ...status, refreshSoon };
}

export function StartConciergeClient({
  initialPath,
  initialSession = null,
}: {
  initialPath?: "franchise" | "standard";
  initialSession?: VerifiedSession | null;
}) {
  const [session, setSession] = useState<VerifiedSession | null>(initialSession);
  const dealId = session?.dealId ?? null;
  const journeyStatus = useJourneyStatus(dealId);

  const [chapter, setChapter] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [purposes, setPurposes] = useState<string[]>(
    initialPath === "franchise" ? ["franchise"] : [],
  );
  const [totalAmount, setTotalAmount] = useState(0);
  const isFranchise = purposes.includes("franchise");

  // Resume at the right chapter when a returning borrower loads the page
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (initialized) return;
    if (journeyStatus.hasDealId && journeyStatus.fieldProgress) {
      setChapter(chapterFromFieldProgress(journeyStatus.fieldProgress, journeyStatus.sealed));
      setInitialized(true);
    } else if (journeyStatus.hasDealId) {
      setInitialized(true);
    }
  }, [journeyStatus.hasDealId, journeyStatus.fieldProgress, journeyStatus.sealed, initialized]);

  if (!session) {
    return <BorrowerWorkspaceGate onVerified={setSession} />;
  }

  // Sealed deal → PostSubmitHub
  if (journeyStatus.sealed) {
    return <PostSubmitHub token={session.dealId} />;
  }

  const handlePurposeContinue = (selectedPurposes: string[], total: number) => {
    setPurposes(selectedPurposes);
    setTotalAmount(total);
    setChapter(2);
  };

  return (
    <div>
      <div className="mb-3 text-center">
        <p className="text-sm text-slate-500">
          {session.name ? `Welcome, ${session.name} — this` : "This"} is your private workspace.{" "}
          <button
            type="button"
            onClick={async () => {
              if (
                !window.confirm(
                  "Start a brand-new application on this device? Your current one is safe — you can always get back to it by re-verifying with the email you used.",
                )
              ) {
                return;
              }
              await fetch("/api/brokerage/session/clear", { method: "POST" });
              window.location.reload();
            }}
            className="font-medium text-slate-500 underline decoration-dotted hover:text-slate-800"
          >
            Not you? Start a new application
          </button>
        </p>
      </div>

      <GuidedIntakeShell
        currentChapter={chapter}
        dealId={session.dealId}
        onChapterChange={(n) => setChapter(n as 1 | 2 | 3 | 4 | 5)}
        totalAmount={totalAmount}
        journeyStatus={journeyStatus}
        fieldProgress={journeyStatus.fieldProgress}
        nextStepsSummary={describeNextSteps(journeyStatus.fieldProgress?.remainingFactPaths ?? [])}
      >
        {chapter === 1 && (
          <IntakePurposeStep
            dealId={session.dealId}
            initialSelections={initialPath === "franchise" ? ["franchise"] : undefined}
            onContinue={handlePurposeContinue}
          />
        )}
        {chapter === 2 && (
          <IntakeBusinessStep
            dealId={session.dealId}
            onContinue={() => setChapter(3)}
          />
        )}
        {chapter === 3 && (
          <IntakeOwnershipStep
            dealId={session.dealId}
            onContinue={() => setChapter(4)}
          />
        )}
        {chapter === 4 && (
          <IntakeFinancialsStep
            dealId={session.dealId}
            isFranchise={isFranchise}
            onContinue={() => setChapter(5)}
          />
        )}
        {chapter === 5 && (
          <IntakeReviewStep
            dealId={session.dealId}
            purposes={purposes}
            verifications={deriveVerifications({
              identityVerificationCount: journeyStatus.identityVerificationCount,
              ownershipEntityCount: journeyStatus.ownershipEntityCount,
              documentsUploadedCount: journeyStatus.documentsUploadedCount,
            })}
            onNavigateChapter={(n) => setChapter(n as 1 | 2 | 3 | 4 | 5)}
            token={session.dealId}
          />
        )}
      </GuidedIntakeShell>

      <FloatingConcierge dealId={session.dealId} borrowerName={session.name} />
    </div>
  );
}
