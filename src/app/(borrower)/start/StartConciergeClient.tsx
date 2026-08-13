"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BorrowerWorkspaceGate, type VerifiedSession } from "@/components/brokerage/BorrowerWorkspaceGate";
import { ApplicationChooserScreen } from "@/components/brokerage/ApplicationChooserScreen";
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
  franchiseMatched: boolean;
}): DealVerificationState {
  return {
    entityResolved: counts.ownershipEntityCount >= 1,
    identityVerified: counts.identityVerificationCount >= 1,
    financialsExtracted: counts.documentsUploadedCount > 0,
    franchiseMatched: counts.franchiseMatched,
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

type BorrowerScoreData = {
  score: number;
  band: string;
  eligibilityPassed: boolean;
  eligibilityFailures?: Array<{ check: string; reason: string }>;
  topStrengths: string[];
  topWeaknesses: string[];
  narrative: string;
  computedAt: string | null;
} | null;

type ExtendedJourneyStatus = JourneyStatusInput & {
  fieldProgress: FieldProgress | null;
  gateReasons: string[];
  identityVerificationCount: number;
  ownershipEntityCount: number;
  franchiseMatched: boolean;
  scoreData: BorrowerScoreData;
  refreshSoon: () => void;
};

function useJourneyStatus(dealId: string | null): ExtendedJourneyStatus {
  const [status, setStatus] = useState<JourneyStatusInput & { fieldProgress: FieldProgress | null; gateReasons: string[]; identityVerificationCount: number; ownershipEntityCount: number; franchiseMatched: boolean; scoreData: BorrowerScoreData }>({
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
    franchiseMatched: false,
    scoreData: null,
  });
  const consecutiveErrorsRef = useRef(0);

  const refresh = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/brokerage/deals/${id}/seal-status`);
        if (!res.ok) {
          consecutiveErrorsRef.current += 1;
          return;
        }
        const json = await res.json();
        if (!json?.ok) {
          consecutiveErrorsRef.current += 1;
          return;
        }
        consecutiveErrorsRef.current = 0;
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
          franchiseMatched: Boolean(json.franchiseMatched),
          scoreData: json.score ?? null,
        });
      } catch {
        consecutiveErrorsRef.current += 1;
      }
    },
    [],
  );

  const sealedRef = useRef(false);
  useEffect(() => {
    sealedRef.current = status.sealed;
  }, [status.sealed]);

  useEffect(() => {
    if (!dealId) return;
    void refresh(dealId);
    let handle: ReturnType<typeof setTimeout>;
    let stopped = false;
    function schedule() {
      if (stopped) return;
      const errors = consecutiveErrorsRef.current;
      const sealed = sealedRef.current;
      const interval = sealed ? 60_000 : errors > 0 ? Math.min(JOURNEY_POLL_MS * 2 ** errors, 120_000) : JOURNEY_POLL_MS;
      handle = setTimeout(() => {
        if (stopped) return;
        void refresh(dealId!).then(schedule);
      }, interval);
    }
    schedule();
    return () => { stopped = true; clearTimeout(handle); };
  }, [dealId, refresh]);

  const refreshSoon = useCallback(() => {
    if (!dealId) return;
    window.setTimeout(() => void refresh(dealId), VOICE_TURN_REFRESH_DELAY_MS);
  }, [dealId, refresh]);

  return { ...status, refreshSoon };
}

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
  onCreateNew: () => Promise<void>;
  onClose: () => void;
}) {
  const [applications, setApplications] = useState<QAApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/qa/borrower/applications", { credentials: "include" })
      .then((r) => {
        if (!r.ok) {
          if (r.status === 401) {
            setLoadError("Not authorized — verify your QA email first.");
          } else {
            setLoadError("Could not load applications. Please try again.");
          }
          return { ok: false };
        }
        return r.json();
      })
      .then((json) => {
        if (json?.ok) setApplications(json.applications ?? []);
      })
      .catch(() => {
        setLoadError("Connection lost while loading applications.");
      })
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

      {!loading && loadError && (
        <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
          {loadError}
        </p>
      )}

      {!loading && !loadError && applications.length === 0 && (
        <p className="text-xs text-slate-500">No existing QA applications found.</p>
      )}

      {!loading && !loadError && applications.length > 0 && (
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

      {createError && (
        <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
          {createError}
        </p>
      )}

      <button
        onClick={async () => {
          setCreating(true);
          setCreateError(null);
          try {
            await onCreateNew();
          } catch (e: any) {
            setCreateError(e?.message ?? "Could not create a new test application. Please try again.");
          } finally {
            setCreating(false);
          }
        }}
        disabled={creating}
        className="w-full rounded-lg border border-dashed border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
      >
        {creating ? "Creating..." : "Start new QA application"}
      </button>
    </div>
  );
}

/**
 * P0 SECURITY: QA blocker component with distinct UI per authorization state.
 * Renders NO chapters, NO progress hydration, NO seal-status polling.
 */
function QABlockedState({
  state,
  authName,
  dealId,
  onResume,
  onCreateNew,
}: {
  state: "confirmed_non_test" | "no_selected_deal" | "classification_failure";
  authName: string | null;
  dealId: string | null;
  onResume: (dealId: string) => void;
  onCreateNew: () => Promise<void>;
}) {
  const stateLabels: Record<string, { title: string; description: string; showChooser: boolean }> = {
    confirmed_non_test: {
      title: "QA workspace requires a test application",
      description: `Your session is bound to a non-test production deal${dealId ? ` (${dealId})` : ""}. Create or resume a QA test application.`,
      showChooser: true,
    },
    no_selected_deal: {
      title: "QA workspace — select a test application",
      description: "No application is selected. Create a new QA test application or resume an existing one.",
      showChooser: true,
    },
    classification_failure: {
      title: "Unable to verify application status",
      description: "We could not confirm whether your session is bound to a test application. This is a safety block — no deal data is loaded.",
      showChooser: false,
    },
  };

  const info = stateLabels[state] ?? stateLabels.classification_failure;

  return (
    <div>
      <TestApplicationBanner isTest={false} />
      <div className="space-y-4 py-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-slate-800">{info.title}</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto">{info.description}</p>
        <p className="text-xs text-slate-400">Authorization state: <code className="bg-slate-100 px-1 rounded">{state}</code></p>
        {info.showChooser && (
          <div className="max-w-sm mx-auto">
            <QAApplicationPanel
              onResume={onResume}
              onCreateNew={onCreateNew}
              onClose={() => {}}
            />
          </div>
        )}
        {!info.showChooser && (
          <button
            onClick={() => window.location.reload()}
            className="mx-auto mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function StartConciergeClient({
  initialPath,
  initialSession = null,
  qaAuthState = null,
  qaAuthName = null,
  qaIsTest = false,
  qaDealId = null,
}: {
  initialPath?: "franchise" | "standard";
  initialSession?: VerifiedSession | null;
  /** P0 SECURITY: QA authorization state from server. Non-null only when isQA=true. */
  qaAuthState?: "confirmed_test" | "confirmed_non_test" | "no_selected_deal" | "classification_failure" | null;
  qaAuthName?: string | null;
  qaIsTest?: boolean;
  qaDealId?: string | null;
}) {
  const [session, setSession] = useState<VerifiedSession | null>(initialSession);
  const dealId = session?.dealId ?? null;

  // P0-6: QA panel state
  const [showQAPanel, setShowQAPanel] = useState(false);
  // P0 SECURITY: QA identitity detected on client (via qaNeedsChooser response).
  // Distinct from qaAuthState which comes from page.tsx server props.
  const [clientQADetected, setClientQADetected] = useState(false);
  // Welcome Back chooser: true when the just-verified email has one or
  // more prior applications and must explicitly choose resume/view/new.
  const [clientApplicationChoiceNeeded, setClientApplicationChoiceNeeded] = useState(false);

  // ── P0 SECURITY: Compute authorizedDealId BEFORE any hooks or requests ──
  // For non-QA: session dealId is always authorized.
  // For QA: null initially (unless confirmed_test from server), then enabled
  // after explicit user Create/Resume via qaExplicitlySelected flag.
  const serverQA = qaAuthState !== null;
  const isQA = serverQA || clientQADetected;
  const [qaExplicitlySelected, setQAExplicitlySelected] = useState(false);
  const authorizedDealId: string | null = isQA
    ? ((qaAuthState === "confirmed_test" || qaExplicitlySelected) ? (session?.dealId ?? null) : null)
    : (session?.dealId ?? null);

  const journeyStatus = useJourneyStatus(authorizedDealId);

  const [chapter, setChapter] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [purposes, setPurposes] = useState<string[]>(
    initialPath === "franchise" ? ["franchise"] : [],
  );
  const [totalAmount, setTotalAmount] = useState(0);
  const isFranchise = purposes.includes("franchise");
  // P0 FIX: franchise must not imply startup. isStartup derives ONLY from start_business.
  const isStartup = purposes.includes("start_business");

  // ── SPEC-BORROWER-RESUME-PERSISTENCE-V3 ──
  const [saveError, setSaveError] = useState<string | null>(null);
  const [progressHydrated, setProgressHydrated] = useState(false);

  // Hydrate progress + chapter facts from server on mount / deal change
  const hydrateProgress = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/borrower/intake/progress", { credentials: "include" });
      const json = await res.json();
      if (json?.ok && json.progress) {
        const p = json.progress;
        console.log(
          "[start] hydrated deal=" + id +
          " ch=" + p.currentChapter +
          " completed=" + (p.completedChapters ?? []).join(",") +
          " lastValid=" + (p.lastValidChapter ?? "none") +
          " v=" + p.progressVersion,
        );
        // Resolve chapter: use persisted, but don't exceed what facts justify
        const validatedChapter = Math.min(
          p.currentChapter ?? 1,
          (p.completedChapters ?? []).length + 1,
        ) as 1 | 2 | 3 | 4 | 5;
        setChapter(Math.max(1, Math.min(5, validatedChapter)) as 1 | 2 | 3 | 4 | 5);
        // Hydrate facts into local state
        if (p.facts) {
          setPurposes(p.facts.purposes ?? []);
          setTotalAmount(p.facts.totalAmount ?? 0);
        }
      } else {
        // No progress row — start fresh, but don't overwrite with blanks
        // if the user is on a deal with existing facts
        if (journeyStatus.hasDealId && journeyStatus.fieldProgress?.determinable) {
          const fallbackChapter = chapterFromFieldProgress(
            journeyStatus.fieldProgress,
            journeyStatus.sealed,
          );
          console.log("[start] fieldProgress fallback deal=" + id + " ch=" + fallbackChapter);
          setChapter(fallbackChapter);
        }
      }
    } catch (err) {
      console.warn("[start] hydrateProgress failed", err);
    } finally {
      setProgressHydrated(true);
      setSaveError(null);
    }
  }, [journeyStatus.hasDealId, journeyStatus.fieldProgress, journeyStatus.sealed]);

  useEffect(() => {
    if (!dealId || progressHydrated) return;
    hydrateProgress(dealId);
  }, [dealId, progressHydrated, hydrateProgress]);

  // Re-hydrate when deal changes (QA resume / new deal)
  const prevDealIdRef = useRef(dealId);
  useEffect(() => {
    if (dealId && dealId !== prevDealIdRef.current) {
      prevDealIdRef.current = dealId;
      setProgressHydrated(false);
      setSaveError(null);
      setChapter(1);
      setPurposes([]);
      setTotalAmount(0);
    }
  }, [dealId]);

  // ── SPEC-BORROWER-RESUME-PERSISTENCE-V3: fail-closed save ──
  const saveProgress = useCallback(
    async (nextChapter: 1 | 2 | 3 | 4 | 5, data?: Record<string, unknown>): Promise<boolean> => {
      if (!dealId) return false;
      setSaveError(null);
      try {
        const res = await fetch("/api/borrower/intake/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ chapter: nextChapter, data: data ?? {} }),
        });
        const json = await res.json();
        if (!json?.ok) {
          setSaveError(json.error === "chapter_save_failed"
            ? "Could not save your answers. Please try again."
            : json.error === "progress_save_failed"
              ? "Could not save your progress. Please try again."
              : "Something went wrong saving your progress. Please try again.");
          return false;
        }
        console.log(
          "[start] saved ch=" + nextChapter +
          " completed=" + (json.progress?.completedChapters ?? []).join(",") +
          " v=" + json.progress?.progressVersion,
        );
        return true;
      } catch {
        setSaveError("Connection lost while saving. Check your network and try again.");
        return false;
      }
    },
    [dealId],
  );

  // Navigate only after confirmed save
  const navigateToChapter = useCallback(
    async (nextChapter: 1 | 2 | 3 | 4 | 5, data?: Record<string, unknown>) => {
      const ok = await saveProgress(nextChapter, data);
      if (!ok) return; // Stay on current chapter — error already set
      setChapter(nextChapter);
      setSaveError(null);
    },
    [saveProgress],
  );
  // ── END V3 ──

  // P0-6: QA borrower — resume from QA application list
  const handleQAResume = async (resumedDealId: string) => {
    const res = await fetch("/api/qa/borrower/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "resume", dealId: resumedDealId }),
    });
    const json = await res.json().catch(() => ({}));
    if (json.ok) {
      setShowQAPanel(false);
      setProgressHydrated(false);
      setSaveError(null);
      setChapter(1);
      setPurposes([]);
      setTotalAmount(0);
      setSession({ dealId: json.dealId, name: qaAuthName ?? null });
      setQAExplicitlySelected(true);
    } else {
      throw new Error(json?.error ?? "Could not resume that application. Please try again.");
    }
  };

  // P0-6: QA borrower — create new application
  const handleQACreate = async () => {
    const res = await fetch("/api/qa/borrower/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "create" }),
    });
    const json = await res.json().catch(() => ({}));
    if (json.ok) {
      setShowQAPanel(false);
      setProgressHydrated(false);
      setSaveError(null);
      setChapter(1);
      setPurposes([]);
      setTotalAmount(0);
      setSession({ dealId: json.dealId, name: qaAuthName ?? null });
      setQAExplicitlySelected(true);
    } else {
      throw new Error(json?.error ?? "Could not create a new test application. Please try again.");
    }
  };

  // P0 SECURITY: Wrapper around setSession that detects QA identity from client OTP response.
  const handleVerified = useCallback((vs: VerifiedSession) => {
    if (vs.qaNeedsChooser) {
      setClientQADetected(true);
    }
    if (vs.applicationChoiceNeeded) {
      setClientApplicationChoiceNeeded(true);
    }
    setSession(vs);
  }, []);

  if (!session) {
    return <BorrowerWorkspaceGate onVerified={handleVerified} />;
  }

  // Welcome Back chooser: verified email has prior applications, no deal
  // has been chosen yet. Never auto-resumes — the borrower must pick.
  if (clientApplicationChoiceNeeded && !session.dealId) {
    return (
      <ApplicationChooserScreen
        onResolved={(dealId) => {
          setClientApplicationChoiceNeeded(false);
          setSession({ dealId, name: session.name ?? null });
        }}
      />
    );
  }

  // ── P0 SECURITY: Fail-closed guard for QA identities ──
  // QA identities must never render chapters, poll seal-status, or hydrate progress
  // when the authorization state is anything other than confirmed_test AND the user
  // has not explicitly selected a test deal.
  if (isQA && qaAuthState !== "confirmed_test" && !qaExplicitlySelected) {
    return <QABlockedState
      state={qaAuthState ?? "no_selected_deal"}
      authName={qaAuthName}
      dealId={qaDealId}
      onResume={handleQAResume}
      onCreateNew={handleQACreate}
    />;
  }

  const isQAWithTestDeal = isQA && qaAuthState === "confirmed_test" && qaIsTest;

  // After all fail-closed guards, session.dealId must be non-null.
  // Narrowed here to avoid repeating null checks through every child component.
  const nonNullDealId: string = session.dealId!;

  // Sealed deal → PostSubmitHub
  if (journeyStatus.sealed) {
    return (
      <div>
        {isQAWithTestDeal && <TestApplicationBanner isTest={true} />}
        <PostSubmitHub token={nonNullDealId} />
      </div>
    );
  }

  const handlePurposeContinue = async (selectedPurposes: string[], total: number) => {
    setPurposes(selectedPurposes);
    setTotalAmount(total);
    const isFranchise = selectedPurposes.includes("franchise");
    const isStartup = selectedPurposes.includes("start_business");
    await navigateToChapter(2, {
      purposes: selectedPurposes,
      totalAmount: total,
      isFranchise,
      isStartup,
      amountUnknown: selectedPurposes.length > 0 && total === 0,
    });
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

      {/* QA action panel */}
      {isQA && (
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

      {/* Durable save error banner */}
      {saveError && (
        <div className="mb-4 animate-in fade-in rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span>{saveError}</span>
          </div>
        </div>
      )}

      <GuidedIntakeShell
        currentChapter={chapter}
        dealId={nonNullDealId}
        onChapterChange={(n) => { void navigateToChapter(n as 1 | 2 | 3 | 4 | 5); }}
        totalAmount={totalAmount}
        journeyStatus={journeyStatus}
        fieldProgress={journeyStatus.fieldProgress}
        nextStepsSummary={describeNextSteps(journeyStatus.fieldProgress?.remainingFactPaths ?? [])}
      >
        {!progressHydrated ? (
          <div className="flex items-center justify-center py-20">
            <div className="space-y-4 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-blue-200 border-t-brand-blue-600" />
              <p className="text-sm text-slate-400">Loading your application…</p>
            </div>
          </div>
        ) : (
          <>
            {chapter === 1 && (
              <IntakePurposeStep
                dealId={nonNullDealId}
                initialSelections={initialPath === "franchise" ? ["franchise"] : undefined}
                onContinue={handlePurposeContinue}
              />
            )}
            {chapter === 2 && (
              <IntakeBusinessStep
                dealId={nonNullDealId}
                isStartup={isStartup}
                onContinue={() => { void navigateToChapter(3); }}
              />
            )}
            {chapter === 3 && (
              <IntakeOwnershipStep
                dealId={nonNullDealId}
                onContinue={() => { void navigateToChapter(4); }}
              />
            )}
            {chapter === 4 && (
              <IntakeFinancialsStep
                dealId={nonNullDealId}
                isFranchise={isFranchise}
                onContinue={() => { void navigateToChapter(5); }}
              />
            )}
            {chapter === 5 && (
              <IntakeReviewStep
                dealId={nonNullDealId}
                purposes={purposes}
                verifications={deriveVerifications({
                  identityVerificationCount: journeyStatus.identityVerificationCount,
                  ownershipEntityCount: journeyStatus.ownershipEntityCount,
                  documentsUploadedCount: journeyStatus.documentsUploadedCount,
                  franchiseMatched: journeyStatus.franchiseMatched,
                })}
                onNavigateChapter={(n) => { void navigateToChapter(n as 1 | 2 | 3 | 4 | 5); }}
                token={nonNullDealId}
                scoreData={journeyStatus.scoreData}
              />
            )}
          </>
        )}
      </GuidedIntakeShell>

      <FloatingConcierge dealId={nonNullDealId} borrowerName={session.name} />
    </div>
  );
}
