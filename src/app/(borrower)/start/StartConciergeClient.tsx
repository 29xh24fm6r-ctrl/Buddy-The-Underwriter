"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { TestApplicationBanner } from "@/components/qa/TestApplicationBanner";
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

/** P0-6: QA session data from server */
type QASessionData = {
  isQA: boolean;
  dealId: string;
  name: string | null;
  isTest: boolean;
};

/** P0-6: QA application list entry */
type QAApplication = {
  id: string;
  test_run_id: string;
  test_created_at: string;
  display_name: string;
  stage: string;
  status: string;
};

function QAApplicationPanel({
  onResume,
  onCreateNew,
  onClose,
}: {
  onResume: (dealId: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  const [applications, setApplications] = useState<QAApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/qa/borrower/applications", { credentials: "include" })
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setApplications(json.applications ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-amber-900">
          QA Test Applications
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-amber-600 underline hover:text-amber-800"
        >
          Hide
        </button>
      </div>

      {loading && <p className="text-xs text-slate-500">Loading applications...</p>}

      {!loading && applications.length === 0 && (
        <p className="text-xs text-slate-500">No existing QA applications found.</p>
      )}

      {!loading && applications.length > 0 && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {applications.map((app) => (
            <div
              key={app.id}
              className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-700 truncate">
                  {app.display_name ?? "QA Application"}
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  {app.test_run_id} &middot; {app.stage ?? "draft"} &middot;{" "}
                  {app.test_created_at
                    ? new Date(app.test_created_at).toLocaleDateString()
                    : "—"}
                </p>
              </div>
              <button
                onClick={() => onResume(app.id)}
                className="ml-2 shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
              >
                Resume
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => {
          setCreating(true);
          onCreateNew();
        }}
        disabled={creating}
        className="w-full rounded-lg border border-dashed border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
      >
        {creating ? "Creating..." : "Start new QA application"}
      </button>
    </div>
  );
}

export function StartConciergeClient({
  initialPath,
  initialSession = null,
  qaSession = null,
}: {
  initialPath?: "franchise" | "standard";
  initialSession?: VerifiedSession | null;
  qaSession?: QASessionData | null;
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

  // P0-6: QA panel state
  const [showQAPanel, setShowQAPanel] = useState(false);

  // ── SPEC-BORROWER-RESUME-PERSISTENCE-V1 ──
  // Hydrate intake progress from the database on mount / deal change.
  // Falls back to chapterFromFieldProgress only if no progress row exists.
  const [progressHydrated, setProgressHydrated] = useState(false);

  const hydrateProgress = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/borrower/intake/progress", {
        credentials: "include",
      });
      const json = await res.json();
      if (json?.ok && json.progress) {
        const p = json.progress;
        console.log(
          "[start] hydrated progress deal=" + id + " ch=" + p.currentChapter +
          " purposes=" + (p.purposes ?? []).join(",") +
          " total=" + p.totalAmount +
          " completed=" + (p.completedChapters ?? []).join(","),
        );
        setChapter(p.currentChapter);
        setPurposes(p.purposes ?? []);
        setTotalAmount(p.totalAmount ?? 0);
      } else {
        // No persisted progress — fall back to fieldProgress.
        if (journeyStatus.hasDealId && journeyStatus.fieldProgress) {
          const fallbackChapter = chapterFromFieldProgress(
            journeyStatus.fieldProgress,
            journeyStatus.sealed,
          );
          console.log(
            "[start] no progress row — fallback fieldProgress deal=" + id +
            " determinable=" + journeyStatus.fieldProgress.determinable +
            " ch=" + fallbackChapter,
          );
          setChapter(fallbackChapter);
        }
      }
    } catch (err) {
      console.warn("[start] hydrateProgress failed", err);
    } finally {
      setProgressHydrated(true);
    }
  }, [journeyStatus.hasDealId, journeyStatus.fieldProgress, journeyStatus.sealed]);

  useEffect(() => {
    if (!dealId || progressHydrated) return;
    hydrateProgress(dealId);
  }, [dealId, progressHydrated, hydrateProgress]);

  // Re-hydrate when deal changes (e.g., QA resume switches deals).
  const prevDealIdRef = useRef(dealId);
  useEffect(() => {
    if (dealId && dealId !== prevDealIdRef.current) {
      prevDealIdRef.current = dealId;
      setProgressHydrated(false);
      setChapter(1);
      setPurposes([]);
      setTotalAmount(0);
    }
  }, [dealId]);

  // ── SPEC-BORROWER-RESUME-PERSISTENCE-V1 (end) ──

  // P0-6: QA borrower — handle resume from QA application list
  const handleQAResume = async (resumedDealId: string) => {
    try {
      const res = await fetch("/api/qa/borrower/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "resume", dealId: resumedDealId }),
      });
      const json = await res.json();
      if (json.ok) {
        setShowQAPanel(false);
        setProgressHydrated(false);
        setChapter(1);
        setPurposes([]);
        setTotalAmount(0);
        setSession({ dealId: json.dealId, name: qaSession?.name ?? null });
      }
    } catch {
      // non-fatal
    }
  };

  // P0-6: QA borrower — create new application
  const handleQACreate = async () => {
    try {
      const res = await fetch("/api/qa/borrower/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "create" }),
      });
      const json = await res.json();
      if (json.ok) {
        setShowQAPanel(false);
        setProgressHydrated(false);
        setChapter(1);
        setPurposes([]);
        setTotalAmount(0);
        setSession({ dealId: json.dealId, name: qaSession?.name ?? null });
      }
    } catch {
      // non-fatal
    }
  };

  // ── SPEC-BORROWER-RESUME-PERSISTENCE-V1 — save on chapter transition ──
  const saveProgress = useCallback(
    async (
      nextChapter: 1 | 2 | 3 | 4 | 5,
      newPurposes?: string[],
      newTotal?: number,
      newCompletedChapters?: number[],
    ) => {
      if (!dealId) return;
      const actualPurposes = newPurposes ?? purposes;
      const actualTotal = newTotal ?? totalAmount;
      const leavingChapter = chapter;
      const completed = newCompletedChapters ?? [];
      const merged = Array.from(
        new Set([...completed, leavingChapter]),
      ).filter((c) => c < nextChapter);
      try {
        await fetch("/api/borrower/intake/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            chapter: nextChapter,
            purposes: actualPurposes,
            totalAmount: actualTotal,
            completedChapters: merged,
          }),
        });
      } catch (err) {
        console.warn("[start] saveProgress failed", err);
      }
    },
    [dealId, chapter, purposes, totalAmount],
  );
  // ── END save on transition ──

  // ── SPEC-BORROWER-RESUME-PERSISTENCE-V1 — save before navigating ──
  const navigateToChapter = useCallback(
    (nextChapter: 1 | 2 | 3 | 4 | 5) => {
      saveProgress(nextChapter);
      setChapter(nextChapter);
    },
    [saveProgress],
  );

  if (!session) {
    return <BorrowerWorkspaceGate onVerified={setSession} />;
  }

  // P0-6: Is this the QA borrower with test deals?
  const isQAWithTestDeal = qaSession?.isQA === true && qaSession.isTest;

  // Sealed deal → PostSubmitHub
  if (journeyStatus.sealed) {
    return (
      <div>
        {isQAWithTestDeal && <TestApplicationBanner isTest={true} />}
        <PostSubmitHub token={session.dealId} />
      </div>
    );
  }

  const handlePurposeContinue = (selectedPurposes: string[], total: number) => {
    setPurposes(selectedPurposes);
    setTotalAmount(total);
    // Persist chapter 1→2 with purpose data before navigating
    saveProgress(2, selectedPurposes, total);
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

      {/* P0-6: QA borrower action panel */}
      {qaSession?.isQA && (
        <div className="mb-4">
          {showQAPanel ? (
            <QAApplicationPanel
              onResume={handleQAResume}
              onCreateNew={handleQACreate}
              onClose={() => setShowQAPanel(false)}
            />
          ) : (
            <button
              onClick={() => setShowQAPanel(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
            >
              Browse QA applications
            </button>
          )}
        </div>
      )}

      <GuidedIntakeShell
        currentChapter={chapter}
        dealId={session.dealId}
        onChapterChange={(n) => navigateToChapter(n as 1 | 2 | 3 | 4 | 5)}
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
            onContinue={() => navigateToChapter(3)}
          />
        )}
        {chapter === 3 && (
          <IntakeOwnershipStep
            dealId={session.dealId}
            onContinue={() => navigateToChapter(4)}
          />
        )}
        {chapter === 4 && (
          <IntakeFinancialsStep
            dealId={session.dealId}
            isFranchise={isFranchise}
            onContinue={() => navigateToChapter(5)}
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
            onNavigateChapter={(n) => navigateToChapter(n as 1 | 2 | 3 | 4 | 5)}
            token={session.dealId}
          />
        )}
      </GuidedIntakeShell>

      <FloatingConcierge dealId={session.dealId} borrowerName={session.name} />
    </div>
  );
}
