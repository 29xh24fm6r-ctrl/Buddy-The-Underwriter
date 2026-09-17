"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BorrowerWorkspaceGate,
  type VerifiedSession,
} from "@/components/brokerage/BorrowerWorkspaceGate";
import { ApplicationChooserScreen } from "@/components/brokerage/ApplicationChooserScreen";
import {
  type JourneyStatusInput,
  type MarketplaceListingStatus,
} from "@/components/brokerage/BrokerageStageStrip";
import { GuidedPackageWorkspace } from "@/components/borrower/intake/GuidedPackageWorkspace";
import { PostSubmitHub } from "@/components/borrower/intake/PostSubmitHub";
import { TestApplicationBanner } from "@/components/qa/TestApplicationBanner";
import { BORROWER_FIELD_REGISTRY } from "@/lib/sba/forms/borrowerFieldRegistry";
import { BorrowerWelcome } from "@/components/borrower/intake/BorrowerWelcome";
import type { FieldProgress } from "@/lib/sba/forms/borrowerFieldProgress";

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
  return (
    BOOTSTRAP_STEP_LABELS[field] ?? REGISTRY_LABEL_BY_FACT_PATH[field] ?? field
  );
}

export function describeNextSteps(fields: string[]): string | null {
  if (fields.length === 0) return null;
  const labels = fields.map(labelForNextStep);
  if (labels.length === 1) return `One thing left: ${labels[0]}.`;
  const last = labels[labels.length - 1];
  const rest = labels.slice(0, -1).join(", ");
  return `${labels.length} things left: ${rest} and ${last}.`;
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

/**
 * Outstanding Items — eligibility requirements that are NOT failures.
 * Computed by the five-state size evaluator, persisted in the score's
 * input_snapshot, and returned by seal-status. Surfaced to the borrower as
 * Remaining Requirements so an internal data gap is never presented as an
 * SBA denial.
 */
export type EligibilityUnresolvedItem = {
  check: string;
  category: string;
  state: "needs_information" | "classification_unresolved" | "data_error";
  reason: string;
  nextAction: string | null;
  sopReference?: string;
};

type ExtendedJourneyStatus = JourneyStatusInput & {
  fieldProgress: FieldProgress | null;
  gateReasons: string[];
  identityVerificationCount: number;
  identityVerified?: boolean;
  financialsExtracted?: boolean;
  ownershipEntityCount: number;
  franchiseMatched: boolean;
  scoreData: BorrowerScoreData;
  eligibilityUnresolved: EligibilityUnresolvedItem[];
  refreshSoon: () => void;
};

function useJourneyStatus(dealId: string | null): ExtendedJourneyStatus {
  const [status, setStatus] = useState<
    JourneyStatusInput & {
      fieldProgress: FieldProgress | null;
      gateReasons: string[];
      identityVerificationCount: number;
      identityVerified?: boolean;
      financialsExtracted?: boolean;
      ownershipEntityCount: number;
      franchiseMatched: boolean;
      scoreData: BorrowerScoreData;
      eligibilityUnresolved: EligibilityUnresolvedItem[];
    }
  >({
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
    eligibilityUnresolved: [],
  });
  const refresh = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/brokerage/deals/${id}/seal-status`);
      if (!res.ok) return;
      const json = await res.json();
      if (!json?.ok) return;
      setStatus({
        hasDealId: true,
        progressPct:
          json.fieldProgress?.determinable &&
          json.fieldProgress.requiredTotal > 0
            ? Math.round(
                (json.fieldProgress.completedCount /
                  json.fieldProgress.requiredTotal) *
                  100,
              )
            : 0,
        documentsUploadedCount:
          typeof json.documentsUploadedCount === "number"
            ? json.documentsUploadedCount
            : 0,
        sealed: Boolean(json.sealed),
        listingStatus:
          (json.listing?.status as MarketplaceListingStatus | undefined) ??
          null,
        matchedLenderCount: json.listing?.matchedLenderCount ?? 0,
        claimsCount: Array.isArray(json.claims) ? json.claims.length : 0,
        fieldProgress: json.fieldProgress ?? null,
        gateReasons: Array.isArray(json.gateReasons) ? json.gateReasons : [],
        identityVerified: json.identityVerified === true,
        financialsExtracted: json.financialsExtracted === true,
        identityVerificationCount:
          typeof json.identityVerificationCount === "number"
            ? json.identityVerificationCount
            : 0,
        ownershipEntityCount:
          typeof json.ownershipEntityCount === "number"
            ? json.ownershipEntityCount
            : 0,
        franchiseMatched: Boolean(json.franchiseMatched),
        scoreData: json.score ?? null,
        // seal-status already returns this; it was being discarded here,
        // so "we need your employee count" never reached the borrower.
        eligibilityUnresolved: Array.isArray(json.eligibilityUnresolved)
          ? json.eligibilityUnresolved
          : [],
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (!dealId) return;
    const initialRefresh = window.setTimeout(() => void refresh(dealId), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(dealId);
    };
    const onFocus = () => void refresh(dealId);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initialRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
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

      {loading && (
        <p className="text-xs text-slate-500">Loading applications...</p>
      )}

      {!loading && loadError && (
        <p
          role="alert"
          className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200"
        >
          {loadError}
        </p>
      )}

      {!loading && !loadError && applications.length === 0 && (
        <p className="text-xs text-slate-500">
          No existing QA applications found.
        </p>
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
        <p
          role="alert"
          className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200"
        >
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
            setCreateError(
              e?.message ??
                "Could not create a new test application. Please try again.",
            );
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
  onResume,
  onCreateNew,
}: {
  state: "confirmed_non_test" | "no_selected_deal" | "classification_failure";
  authName: string | null;
  dealId: string | null;
  onResume: (dealId: string) => void;
  onCreateNew: () => Promise<void>;
}) {
  const stateLabels: Record<
    string,
    { title: string; description: string; showChooser: boolean }
  > = {
    confirmed_non_test: {
      title: "Let’s open your test workspace",
      description:
        "Choose a saved test application or start a fresh one. Your existing production application stays separate.",
      showChooser: true,
    },
    no_selected_deal: {
      title: "QA workspace — select a test application",
      description:
        "No application is selected. Create a new QA test application or resume an existing one.",
      showChooser: true,
    },
    classification_failure: {
      title: "Unable to verify application status",
      description:
        "We could not confirm whether your session is bound to a test application. This is a safety block — no deal data is loaded.",
      showChooser: false,
    },
  };

  const info = stateLabels[state] ?? stateLabels.classification_failure;

  return (
    <div>
      <TestApplicationBanner isTest={false} />
      <div className="space-y-4 py-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <svg
            className="h-6 w-6 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-slate-800">{info.title}</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          {info.description}
        </p>

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
  qaAuthState?:
    | "confirmed_test"
    | "confirmed_non_test"
    | "no_selected_deal"
    | "classification_failure"
    | null;
  qaAuthName?: string | null;
  qaIsTest?: boolean;
  qaDealId?: string | null;
}) {
  const [session, setSession] = useState<VerifiedSession | null>(
    initialSession,
  );
  const [welcomeGoal, setWelcomeGoal] = useState("");

  // P0-6: QA panel state
  const [showQAPanel, setShowQAPanel] = useState(false);
  // P0 SECURITY: QA identitity detected on client (via qaNeedsChooser response).
  // Distinct from qaAuthState which comes from page.tsx server props.
  const [clientQADetected, setClientQADetected] = useState(false);
  // Welcome Back chooser: true when the just-verified email has one or
  // more prior applications and must explicitly choose resume/view/new.
  const [clientApplicationChoiceNeeded, setClientApplicationChoiceNeeded] =
    useState(false);

  // ── P0 SECURITY: Compute authorizedDealId BEFORE any hooks or requests ──
  // For non-QA: session dealId is always authorized.
  // For QA: null initially (unless confirmed_test from server), then enabled
  // after explicit user Create/Resume via qaExplicitlySelected flag.
  const serverQA = qaAuthState !== null;
  const isQA = serverQA || clientQADetected;
  const [qaExplicitlySelected, setQAExplicitlySelected] = useState(false);
  const authorizedDealId: string | null = isQA
    ? qaAuthState === "confirmed_test" || qaExplicitlySelected
      ? (session?.dealId ?? null)
      : null
    : (session?.dealId ?? null);

  const journeyStatus = useJourneyStatus(authorizedDealId);

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
      setSession({ dealId: json.dealId, name: qaAuthName ?? null });
      setQAExplicitlySelected(true);
    } else {
      throw new Error(
        json?.error ?? "Could not resume that application. Please try again.",
      );
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
      setSession({ dealId: json.dealId, name: qaAuthName ?? null });
      setQAExplicitlySelected(true);
    } else {
      throw new Error(
        json?.error ??
          "Could not create a new test application. Please try again.",
      );
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
    return (
      <BorrowerWelcome onGoal={setWelcomeGoal}>
        <BorrowerWorkspaceGate onVerified={handleVerified} />
      </BorrowerWelcome>
    );
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
    return (
      <QABlockedState
        state={qaAuthState ?? "no_selected_deal"}
        authName={qaAuthName}
        dealId={qaDealId}
        onResume={handleQAResume}
        onCreateNew={handleQACreate}
      />
    );
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

  return (
    <div>
      <div className="mb-3 text-right">
        <p className="text-sm text-slate-500">
          {session.name ? `Welcome, ${session.name} — this` : "This"} is your
          private workspace.{" "}
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
              className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Test workspace · switch application
            </button>
          )}
        </div>
      )}

      {initialPath === "franchise" && (
        <p className="text-sm text-slate-600">
          Buying or starting a franchise? Include that in your plan so the
          relevant details can be reviewed.
        </p>
      )}
      <GuidedPackageWorkspace
        key={nonNullDealId}
        dealId={nonNullDealId}
        borrowerName={session.name}
        initialGoal={welcomeGoal}
        onSaved={journeyStatus.refreshSoon}
      />
    </div>
  );
}
