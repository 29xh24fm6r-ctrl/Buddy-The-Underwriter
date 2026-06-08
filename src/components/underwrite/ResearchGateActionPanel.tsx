"use client";

/**
 * ResearchGateActionPanel — SPEC-UNDERWRITE-RESEARCH-GATE-END-TO-END-1
 *
 * Blocker-aware research surface for the canonical /deals/[dealId]/underwrite
 * route. When the active memo readiness blocker is `missing_research_quality_gate`,
 * this panel walks the banker through the full dependency chain instead of
 * dead-ending at a generic "workspace not initialized" prompt:
 *
 *   A. workspace missing → explain the workbench is a prerequisite, offer init
 *   B. workspace ready, no mission → offer Run Research
 *   C. mission queued/running → show running state (parent polls)
 *   D. mission failed → show failure, offer Re-run Research
 *   E. mission complete but gate failed → show quality gate failures, offer Re-run
 *   F. gate passed → renders nothing (parent shows normal workbench)
 *
 * This component is presentational. All fetching/POSTing and refresh sequencing
 * is owned by AnalystWorkbench so there is a single source of truth for state.
 */

import { useState } from "react";
import type {
  ResearchGateSnapshot,
  ResearchGatePending,
  ResearchGateGroupItem,
  CommitteeBlockerResolution,
  CommitteeEvidenceTask,
  CommitteeReviewAction,
  CommitteeRequirementsPlan,
  ReviewTaskHandler,
  AttachSourceHandler,
} from "./researchGateTypes";
import {
  deriveResearchGatePhase,
  deriveDecisionReadiness,
  shouldShowCommitteeReadiness,
} from "./researchGatePhase";
// SPEC-BIE-COMMITTEE-READINESS-UX-SIMPLIFICATION-1: banker-facing view-model.
import {
  buildCommitteeReadinessView,
  deriveTaskActions,
  type CommitteeReadinessGroupView,
  type CommitteeReadinessAuditRow,
  type GroupStatusLabel,
  type ReadinessHeroView,
  type CommitteeBlockerLine,
  type CommitteeActionCard,
} from "./committeeReadinessView";

export { shouldShowCommitteeReadiness };

interface Props {
  snapshot: ResearchGateSnapshot;
  workspaceReady: boolean;
  pending: ResearchGatePending;
  onInitialize: () => void;
  onRunResearch: () => void;
  // SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1
  onReviewTask?: ReviewTaskHandler;
}

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div
    data-testid="research-gate-panel"
    className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-6 space-y-4"
  >
    <div className="flex items-center gap-2">
      <span className="inline-flex h-6 items-center rounded-full bg-amber-500/15 px-2 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
        Active blocker
      </span>
      <h2 className="text-sm font-semibold text-amber-100">
        Research quality gate
      </h2>
    </div>
    {children}
  </div>
);

const PrimaryButton = ({
  label,
  busyLabel,
  busy,
  onClick,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    disabled={busy}
    onClick={onClick}
    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
  >
    {busy ? (
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
    ) : null}
    {busy ? busyLabel : label}
  </button>
);

export default function ResearchGateActionPanel({
  snapshot,
  workspaceReady,
  pending,
  onInitialize,
  onRunResearch,
  onReviewTask,
}: Props) {
  const phase = deriveResearchGatePhase(snapshot, workspaceReady, pending);

  // F: gate passed — no research blocker, render nothing.
  if (phase === "passed") return null;

  if (phase === "needs_workbench") {
    return (
      <Shell>
        <div className="space-y-1 text-sm text-amber-100/90">
          <p className="font-medium">
            Research quality gate requires the underwriting workbench.
          </p>
          <p className="text-amber-100/70">
            Initialize the workbench first; then Buddy can run the research
            mission.
          </p>
        </div>
        <PrimaryButton
          label="Initialize Underwriting Workbench"
          busyLabel="Initializing…"
          busy={pending === "init"}
          onClick={onInitialize}
        />
      </Shell>
    );
  }

  if (phase === "no_mission") {
    return (
      <Shell>
        <p className="text-sm text-amber-100/90">
          Research has not been run for this deal. Buddy needs to run research
          before the memo can clear the research quality gate. A banker-certified
          preliminary result is enough for preliminary underwriting; committee-grade
          additionally needs public/attested verification.
        </p>
        <PrimaryButton
          label="Run Research"
          busyLabel="Running research…"
          busy={pending === "run"}
          onClick={onRunResearch}
        />
      </Shell>
    );
  }

  if (phase === "running") {
    return (
      <Shell>
        <div className="flex items-center gap-3 text-sm text-amber-100/90">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300/40 border-t-amber-300" />
          <span>Research is running. This can take a few minutes…</span>
        </div>
      </Shell>
    );
  }

  if (phase === "failed") {
    return (
      <Shell>
        <div className="space-y-1 text-sm">
          <p className="font-medium text-rose-200">
            Research mission {snapshot.missionStatus === "cancelled" ? "was cancelled" : "failed"}.
          </p>
          {snapshot.trustGrade ? (
            <p className="text-amber-100/70">
              Trust grade: <span className="font-mono">{snapshot.trustGrade}</span>
            </p>
          ) : null}
        </div>
        <PrimaryButton
          label="Re-run Research"
          busyLabel="Running research…"
          busy={pending === "run"}
          onClick={onRunResearch}
        />
      </Shell>
    );
  }

  // phase === "gate_failed"
  const readiness = deriveDecisionReadiness(snapshot);
  return (
    <Shell>
      <div className="space-y-2 text-sm">
        <p className="font-medium text-amber-100">
          {readiness.preliminary === "ready"
            ? "Research cleared for preliminary underwriting; committee-grade remains blocked."
            : "Research completed but is not yet ready for preliminary underwriting."}
        </p>
        {/* SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 7:
            decision readiness — preliminary vs committee, with explicit blockers. */}
        <DecisionReadiness readiness={readiness} />
        {/* SPEC-BIE-EVIDENCE-GRAPH-AND-COMMITTEE-BLOCKER-RESOLUTION-1:
            evidence-linked, actionable path from preliminary → committee. */}
        <CommitteeBlockerResolutions
          items={snapshot.committeeBlockerResolutions}
          onReviewTask={onReviewTask}
        />
        {/* SPEC-BIE-COMMITTEE-EVIDENCE-REQUIREMENTS-ENGINE-1: proactive gaps. */}
        <CommitteeRequirements plan={snapshot.committeeRequirementsPlan} />
        <div className="flex flex-wrap gap-4 text-amber-100/70">
          {snapshot.qualityScore != null ? (
            <span>
              Quality score:{" "}
              <span className="font-mono text-amber-100">
                {snapshot.qualityScore}
              </span>
            </span>
          ) : null}
          {snapshot.trustGrade ? (
            <span>
              Trust grade:{" "}
              <span className="font-mono text-amber-100">
                {snapshot.trustGrade}
              </span>
            </span>
          ) : null}
        </div>
        {/* SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: grouped
            action cards. Falls back to the flat gateFailures list when the
            flight deck didn't supply groups. */}
        {snapshot.groups ? (
          <div className="space-y-3">
            <GateGroup
              title="Required identity inputs"
              items={snapshot.groups.requiredIdentityInputs}
            />
            <GateGroup
              title="Research quality issues"
              items={snapshot.groups.researchQualityIssues}
            />
            <GateGroup
              title="Banker-certified evidence on file"
              items={snapshot.groups.bankerCertifiedEvidence}
              presentTone
            />
          </div>
        ) : snapshot.gateFailures.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/80">
              Gate failures
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-amber-100/80">
              {snapshot.gateFailures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <PrimaryButton
        label="Re-run Research"
        busyLabel="Running research…"
        busy={pending === "run"}
        onClick={onRunResearch}
      />
    </Shell>
  );
}

// SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 7
// Module-scoped (NOT defined inside DecisionReadiness) — defining a component
// during another component's render trips react-hooks "Cannot create components
// during render".
function ReadinessPill({ state }: { state: "ready" | "not_ready" }) {
  return (
    <span
      className={
        state === "ready"
          ? "rounded bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-300"
          : "rounded bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-300"
      }
    >
      {state === "ready" ? "Ready" : "Not ready"}
    </span>
  );
}

function DecisionReadiness({
  readiness,
}: {
  readiness: ReturnType<typeof deriveDecisionReadiness>;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/20 bg-black/10 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/80">
        Decision readiness
      </p>
      <div className="flex items-center gap-2 text-xs text-amber-100/90">
        <span className="w-40">Preliminary underwriting</span>
        <ReadinessPill state={readiness.preliminary} />
        {readiness.preliminary === "ready" && readiness.preliminaryBasisLabel ? (
          <span className="text-amber-100/60">on {readiness.preliminaryBasisLabel}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-xs text-amber-100/90">
        <span className="w-40">Committee-grade</span>
        <ReadinessPill state={readiness.committee} />
      </div>
      {readiness.publicWebNote ? (
        <p className="text-[11px] text-amber-100/50">{readiness.publicWebNote}</p>
      ) : null}
      {readiness.committee === "not_ready" && readiness.committeeBlockers.length > 0 ? (
        <div className="space-y-0.5">
          <p className="text-[11px] font-semibold text-amber-300/70">
            Committee-grade remains blocked pending:
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-amber-100/70">
            {readiness.committeeBlockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// SPEC-BIE-EVIDENCE-GRAPH-AND-COMMITTEE-BLOCKER-RESOLUTION-1
/**
 * Non-blocking committee-readiness panel shown when the research gate has
 * PASSED (preliminary cleared) but committee-grade is still blocked. Renders the
 * same Decision Readiness + Committee Blocker Resolution content as the blocker
 * panel, in a neutral (non-amber) shell so it does not read as a hard blocker.
 */
export function CommitteeReadinessPanel({
  snapshot,
  onReviewTask,
  onAttachSource,
}: {
  snapshot: ResearchGateSnapshot;
  onReviewTask?: ReviewTaskHandler;
  onAttachSource?: AttachSourceHandler;
}) {
  return (
    <CommitteeReadinessPanelInner snapshot={snapshot} onReviewTask={onReviewTask} onAttachSource={onAttachSource} />
  );
}

// SPEC-…-FINAL-WORKFLOW-CORRECTION-1: the panel holds which Next Action drawer is
// open so the hero CTA can open the FIRST action's drawer directly (not scroll).
function CommitteeReadinessPanelInner({
  snapshot,
  onReviewTask,
  onAttachSource,
}: {
  snapshot: ResearchGateSnapshot;
  onReviewTask?: ReviewTaskHandler;
  onAttachSource?: AttachSourceHandler;
}) {
  const view = shouldShowCommitteeReadiness(snapshot) ? buildCommitteeReadinessView(snapshot) : null;
  // SPEC-…-DECISION-INTELLIGENCE-1 (A): the top decision opens by default so its
  // support/drawer is immediately visible; the hero CTA re-opens it.
  const [openCardId, setOpenCardId] = useState<string | null>(view?.actionCards[0]?.id ?? null);
  if (!view) return null;
  return (
    <div
      data-testid="committee-readiness-panel"
      className="rounded-xl border border-sky-500/20 bg-sky-500/[0.05] p-5 space-y-4"
    >
      {/* A. Top readiness hero — can it go to committee? CTA opens the first
          Next Action drawer directly. */}
      <ReadinessHero
        hero={view.hero}
        onResolveTop={view.actionCards.length > 0 ? () => setOpenCardId(view.actionCards[0].id) : undefined}
      />

      {/* B. Committee Decisions — each card is a business question, resolved here. */}
      {view.actionCards.length > 0 ? (
        <div className="space-y-3" data-testid="committee-next-actions">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-300/70">Committee decisions</p>
          {view.actionCards.map((card) => (
            <CommitteeTaskActionCard
              key={card.id}
              card={card}
              open={openCardId === card.id}
              onToggle={() => setOpenCardId(openCardId === card.id ? null : card.id)}
              onReviewTask={onReviewTask}
              onAttachSource={onAttachSource}
            />
          ))}
        </div>
      ) : null}

      {/* C. Committee progress — READ-ONLY at-a-glance rail (no expansion). */}
      <CommitteeProgressRail groups={view.groups} />

      {/* D. Committee blockers — read-only summary, shown once (reconciles 1:1
          with Next Actions). */}
      {view.committeeBlockers.length > 0 ? (
        <CommitteeBlockersPanel blockers={view.committeeBlockers} />
      ) : null}

      {/* E. Supporting Details — ONE collapsed disclosure (evidence plan +
          technical audit + internal review state). A banker never needs this in
          normal use; it stays out of the decision flow. */}
      <details
        id="committee-evidence-plan"
        data-testid="committee-readiness-audit"
        className="rounded-lg border border-white/10 bg-black/10 p-3"
      >
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-sky-300/60">
          Supporting details
        </summary>
        <div className="mt-3 space-y-4">
          {snapshot.committeeRequirementsPlan &&
          snapshot.committeeRequirementsPlan.committee_readiness_gaps.length > 0 ? (
            <CommitteeRequirements plan={snapshot.committeeRequirementsPlan} />
          ) : null}
          <CommitteeReadinessAuditTable rows={view.audit} />
          <CommitteeBlockerResolutions items={snapshot.committeeBlockerResolutions} />
        </div>
      </details>
    </div>
  );
}

// SPEC-COMMITTEE-READINESS-BUSINESS-QUESTIONS-1: per-decision banker framing.
// Each committee decision is a BUSINESS QUESTION (domain + question), never a
// task/workflow object. Blocking phrase is the compact "what's blocking" line.
const DECISION_COPY: Record<CommitteeReadinessGroupView["id"], { domain: string; question: string; blocking: string }> = {
  entity: {
    domain: "Business Verification",
    question: "Is the borrowing entity confirmed in official public records?",
    blocking: "Entity record not confirmed",
  },
  risk: {
    domain: "Public Records Review",
    question: "Did the public-record search identify adverse findings?",
    blocking: "Public-records review incomplete",
  },
  management: {
    domain: "Management Quality",
    question: "Do we have enough support for management quality and experience?",
    blocking: "Management support missing",
  },
  financial: {
    domain: "Loan & Repayment Support",
    question: "Is the loan request and repayment support documented?",
    blocking: "Loan/repayment support missing",
  },
  industry: {
    domain: "Industry Validation",
    question: "Do we have enough support for industry position and market strength?",
    blocking: "Industry support missing",
  },
  scale: {
    domain: "Business Scale",
    question: "Does the business appear reasonable in scale for its stated operations?",
    blocking: "Analyst conclusion missing",
  },
};

// SPEC-…-FINAL-WORKFLOW-CORRECTION-1 (A): mission-control hero — large status,
// "X actions required", 3-count progress, and a CTA that OPENS the first Next
// Action drawer directly (onResolveTop), not a scroll/deep-link.
function ReadinessHero({ hero, onResolveTop }: { hero: ReadinessHeroView; onResolveTop?: () => void }) {
  const committeeReady = /committee ready/i.test(hero.statusLine) && !/not ready/i.test(hero.statusLine);
  return (
    <div
      className={
        "rounded-2xl border p-6 space-y-4 " +
        (committeeReady ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-amber-500/30 bg-amber-500/[0.08]")
      }
      data-testid="committee-readiness-hero"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/70">Committee readiness</p>

      {/* Status dominates the section. */}
      <p
        className={
          "flex items-center gap-3 text-3xl font-bold uppercase tracking-wide " +
          (committeeReady ? "text-emerald-300" : "text-amber-200")
        }
      >
        <span aria-hidden>{committeeReady ? "🟢" : "🔴"}</span>
        {committeeReady ? "Ready" : "Not ready"}
      </p>

      {!committeeReady && hero.actionsRequired > 0 ? (
        <p className="text-xl font-semibold text-amber-100" data-testid="committee-hero-actions-required">
          {hero.actionsRequired} decision{hero.actionsRequired === 1 ? "" : "s"} required before committee review
        </p>
      ) : null}

      <p className="text-base text-sky-100/80 max-w-prose">
        Buddy can continue preliminary underwriting. Committee review requires the items below.
      </p>

      {hero.primaryActionLabel && onResolveTop ? (
        <button
          type="button"
          onClick={onResolveTop}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-sky-900/30 hover:bg-sky-400 transition-colors"
          data-testid="committee-hero-primary"
        >
          Start next decision →
        </button>
      ) : null}

      <a href="#committee-evidence-plan" className="block text-[11px] text-sky-300/50 underline decoration-dotted">
        Supporting details ↓
      </a>
    </div>
  );
}

// SPEC-…-POLISH-1 (E): the EXACT committee blockers, listed once as compact
// read-only bullets — nothing else (no status badges, no controls). Reconciles
// 1:1 with the Next Actions cards.
// SPEC-…-BUSINESS-QUESTIONS-1 (4): "What is blocking committee" — max 3 compact
// business bullets (no workflow language, no status badges, read-only).
function CommitteeBlockersPanel({ blockers }: { blockers: CommitteeBlockerLine[] }) {
  const lines = blockers.slice(0, 3);
  return (
    <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] p-4" data-testid="committee-blockers-panel">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/80">
        What is blocking committee
      </p>
      <ul className="mt-2 space-y-1 text-[13px] text-sky-100/85">
        {lines.map((b, i) => (
          <li key={i} className="flex items-center gap-2" data-testid={`committee-blocker-${b.groupId}`}>
            <span className="text-amber-300/70" aria-hidden>•</span>
            <span>{DECISION_COPY[b.groupId].blocking}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// SPEC-…-POLISH-1 (D): Committee Progress — a READ-ONLY, at-a-glance rail. One
// row per group: ✓ complete / ⚠ outstanding + banker name. No expansion, no
// controls. The official-capture-vs-Buddy-receipt signal stays visible (compact)
// so a receipt is never mistaken for an official record.
function CommitteeProgressRail({ groups }: { groups: CommitteeReadinessGroupView[] }) {
  const done = groups.filter((g) => g.status === "Complete").length;
  return (
    <div className="space-y-2" data-testid="committee-progress-rail">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-300/70">Committee progress</p>
      <ul className="space-y-2">
        {groups.map((g) => {
          const ok = g.status === "Complete";
          const src = g.capturedSources[0];
          return (
            <li key={g.id} className="flex items-center gap-2.5 text-[13px]" data-testid={`committee-progress-${g.id}`}>
              <span className={ok ? "text-emerald-400" : "text-amber-300"} aria-hidden>{ok ? "✓" : "⚠"}</span>
              <span className={ok ? "text-sky-100/70" : "text-sky-100"}>{DECISION_COPY[g.id].domain}</span>
              {src && !src.officialCaptureUrl ? (
                <a href={src.receiptUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] text-amber-300/70 underline decoration-dotted">
                  Buddy receipt only
                </a>
              ) : src?.officialCaptureUrl ? (
                <a href={src.officialCaptureUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] text-emerald-300/80 underline decoration-dotted">
                  Official capture
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-sky-100/60" data-testid="committee-progress-count">
        {done} of {groups.length} complete
      </p>
    </div>
  );
}

// SPEC-…-WORKFLOW-RESOLUTION-1: the source-snapshot connector params for a task's
// "attach" primary, by task type. Reuses the existing validated connector kinds /
// source types (no new endpoint).
function attachParamsForTask(taskType: string): { connector_kind: string; source_type: string } {
  if (/sos|registry/i.test(taskType)) return { connector_kind: "secretary_of_state", source_type: "secretary_of_state" };
  if (/adverse/i.test(taskType)) return { connector_kind: "public_adverse_screen", source_type: "public_adverse_record_search" };
  if (/industry|market/i.test(taskType)) return { connector_kind: "trade_or_market_source", source_type: "market_research" };
  if (/competit/i.test(taskType)) return { connector_kind: "competitor_source", source_type: "company_primary" };
  if (/management/i.test(taskType)) return { connector_kind: "manual_url", source_type: "company_primary" };
  return { connector_kind: "manual_url", source_type: "unknown_public_web" };
}

// SPEC-…-POLISH-1 (B/F): obvious primary buttons; subordinate secondaries.
const ACTION_BTN =
  "rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-sky-100/70 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed";
const PRIMARY_BTN =
  "rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-white shadow shadow-sky-900/20 hover:bg-sky-400 transition-colors";

// SPEC-COMMITTEE-ACTION-CENTER-FINAL-WORKFLOW-CORRECTION-1: the ONE canonical
// executable action card, rendered in the Next Actions section. Large + readable;
// the primary opens an in-place resolution drawer (screening result /
// official-capture attach / evidence attach / analyst conclusion) controlled by
// the panel's `open` state so the hero CTA can open the first card directly.
// Needs-review tasks keep the validated review set. Reuses #498 persistence only.
export function CommitteeTaskActionCard({
  card,
  open,
  onToggle,
  onReviewTask,
  onAttachSource,
}: {
  card: CommitteeActionCard;
  open: boolean;
  onToggle: () => void;
  onReviewTask?: ReviewTaskHandler;
  onAttachSource?: AttachSourceHandler;
}) {
  const t = card.task;
  const plan = t ? deriveTaskActions(t) : null;
  const kind = plan?.primaryKind;
  const taskType = String(t?.task_type ?? "");
  const decision = DECISION_COPY[card.groupId];
  const complete = card.status === "Complete";
  const s = card.support;

  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  const run = (action: CommitteeReviewAction, requireReason = false) => {
    if (!t || !onReviewTask) return;
    let r: string | undefined;
    if (requireReason) {
      const entered = typeof window !== "undefined" ? window.prompt("Reason (required):") : null;
      if (!entered || !entered.trim()) return;
      r = entered.trim();
    }
    void onReviewTask(t.id!, action, r ? { reason: r } : undefined);
  };

  // Public-records review: the result IS the decision — two direct buttons.
  const recordResult = (result: "clear" | "finding") => {
    if (t && onReviewTask) void onReviewTask(t.id!, "record_screening_result", { result });
  };

  const saveDrawer = async () => {
    if (!t || !onReviewTask || !plan) return;
    if (kind === "add_conclusion") {
      if (!text.trim()) return;
      await onReviewTask(t.id!, "submit_analyst_conclusion", { note: text.trim() });
    } else {
      if (!url.trim() || !onAttachSource) return;
      await onAttachSource(t.id!, { ...attachParamsForTask(taskType), source_url: url.trim(), note: text.trim() || undefined });
    }
    setText(""); setUrl("");
    onToggle();
  };

  // The one primary action verb, in plain banker language.
  const drawerKind = kind === "add_conclusion" || kind === "capture_official" || kind === "attach_evidence" || kind === "add_loan_request";
  const primaryLabel = kind === "add_conclusion" ? "Enter conclusion" : "Add support";

  return (
    <div
      className={
        "rounded-xl border bg-white/[0.03] p-4 space-y-3 " +
        (open ? "border-sky-400/60 ring-1 ring-sky-400/40" : "border-white/10")
      }
      data-testid={`committee-action-card-${card.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300/70">{decision.domain}</p>
          <p className="mt-1 text-sm font-medium text-sky-100">{decision.question}</p>
        </div>
        <span className={"shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold " + (complete ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200")}>
          {complete ? "Complete" : "Incomplete"}
        </span>
      </div>

      {/* SPEC-…-DECISION-INTELLIGENCE-1: decision support, visible by default so a
          banker never needs Supporting details to understand the decision. */}
      <div className="space-y-2 text-[12px]" data-testid={`committee-decision-support-${card.id}`}>
        <p className="text-sky-100/70"><span className="font-semibold text-sky-200">Why this matters: </span>{s.decisionReason}</p>
        <SupportList label="Buddy found" items={s.evidenceFound} empty="Nothing on file yet." tone="found" />
        {s.evidenceMissing.length > 0 ? <SupportList label="Still needed" items={s.evidenceMissing} tone="missing" /> : null}
        <SupportList label="What satisfies this" items={s.acceptableEvidence} tone="accept" />
        {s.scaleChecklist.length > 0 ? (
          <div data-testid={`committee-scale-checklist-${card.id}`}>
            <p className="font-semibold text-sky-200">Scale factors Buddy considered:</p>
            <ul className="ml-1 mt-0.5 space-y-0.5">
              {s.scaleChecklist.map((it, i) => (
                <li key={i} className={it.present ? "text-emerald-300/80" : "text-amber-300/80"}>
                  {it.present ? "✓" : "✗"} {it.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {s.sourceLinks.length > 0 ? (
          <p className="flex flex-wrap gap-2 text-[11px]">
            {s.sourceLinks.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className={(l.official ? "text-emerald-300/80" : "text-amber-300/70") + " underline decoration-dotted"}>
                {l.official ? "Official capture" : "Buddy receipt only"}: {l.label}
              </a>
            ))}
          </p>
        ) : null}
        {s.sourceLimitations.map((lim, i) => (
          <p key={i} className="text-[11px] text-amber-300/60">{lim}</p>
        ))}
      </div>

      {plan?.note ? <p className="text-[11px] text-amber-300/70">{plan.note}</p> : null}

      {!t || !plan || !onReviewTask ? (
        <p className="text-[12px] text-sky-100/50">Resolve in Supporting details below.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {kind === "record_result" ? (
            <>
              <button type="button" className={PRIMARY_BTN} onClick={() => recordResult("clear")} data-testid={`committee-action-primary-${card.id}`}>No findings</button>
              <button type="button" className={ACTION_BTN} onClick={() => recordResult("finding")}>Findings identified</button>
            </>
          ) : kind === "mark_committee_grade" ? (
            <button type="button" className={PRIMARY_BTN} disabled={plan.committeeGradeDisabled} onClick={() => run("mark_committee_grade")} data-testid={`committee-action-primary-${card.id}`}>Approve</button>
          ) : (
            <button type="button" className={PRIMARY_BTN} onClick={onToggle} aria-expanded={open} data-testid={`committee-action-primary-${card.id}`}>{primaryLabel}</button>
          )}

          {/* Secondary actions hidden behind More options (overrides / request more / reset). */}
          <details className="ml-auto" data-testid={`committee-action-more-${card.id}`}>
            <summary className="cursor-pointer text-[11px] text-sky-300/60">More options ▾</summary>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button type="button" className={ACTION_BTN} onClick={() => run("banker_override", true)}>Override with reason</button>
              <button type="button" className={ACTION_BTN} onClick={() => run("request_more_evidence")}>Request more</button>
              {kind === "mark_committee_grade" ? (
                <>
                  <button type="button" className={ACTION_BTN} onClick={() => run("mark_weak_source")}>Weak source</button>
                  <button type="button" className={ACTION_BTN} onClick={() => run("mark_wrong_entity", true)}>Wrong entity</button>
                  <button type="button" className={ACTION_BTN} onClick={() => run("reject", true)}>Reject</button>
                </>
              ) : null}
              <button type="button" className={ACTION_BTN} onClick={() => run("reset_review")}>Reset</button>
            </div>
          </details>
        </div>
      )}

      {/* SPEC-…-DECISION-INTELLIGENCE-1 (A): for approve/record cards (no drawer),
          the hero CTA / primary opens a highlighted decision-support panel so the
          click ALWAYS produces a visible change and explains what to review. */}
      {t && plan && open && !drawerKind ? (
        <div className="rounded-lg border border-sky-400/40 bg-sky-500/10 p-3 text-[12px]" data-testid={`committee-decision-panel-${card.id}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-300/80">Decision support — review before you decide</p>
          <p className="mt-1 text-sky-100/85">{s.bankerGuidance}</p>
        </div>
      ) : null}

      {/* Drawer for Add support / Enter conclusion (opened by primary OR hero CTA). */}
      {t && plan && open && drawerKind ? (
        <div className="space-y-2 rounded-lg border border-sky-500/25 bg-black/30 p-3" data-testid={`committee-action-drawer-${card.id}`}>
          {kind === "add_conclusion" ? (
            <textarea className="w-full rounded bg-black/40 p-2 text-[12px] text-sky-100" rows={3} placeholder="Enter your analyst conclusion…" value={text} onChange={(e) => setText(e.target.value)} data-testid={`committee-action-conclusion-${card.id}`} />
          ) : (
            <>
              <input className="w-full rounded bg-black/40 p-2 text-[12px] text-sky-100" placeholder="Supporting source URL" value={url} onChange={(e) => setUrl(e.target.value)} data-testid={`committee-action-url-${card.id}`} />
              <input className="w-full rounded bg-black/40 p-2 text-[12px] text-sky-100" placeholder="Notes (optional)" value={text} onChange={(e) => setText(e.target.value)} />
            </>
          )}
          <div className="flex gap-2">
            <button type="button" className={PRIMARY_BTN} onClick={() => void saveDrawer()} data-testid={`committee-action-save-${card.id}`}>Save</button>
            <button type="button" className={ACTION_BTN} onClick={() => { setText(""); setUrl(""); onToggle(); }}>Cancel</button>
          </div>
        </div>
      ) : null}

      {plan?.committeeGradeDisabled && plan.committeeGradeBlockedReason ? (
        <p className="text-[11px] text-rose-300/70">{plan.committeeGradeBlockedReason}</p>
      ) : null}
    </div>
  );
}

// SPEC-…-DECISION-INTELLIGENCE-1: a compact labelled evidence list on a card.
function SupportList({
  label,
  items,
  empty,
  tone,
}: {
  label: string;
  items: string[];
  empty?: string;
  tone: "found" | "missing" | "accept";
}) {
  const labelTone = tone === "found" ? "text-emerald-300/80" : tone === "missing" ? "text-amber-300/80" : "text-sky-200";
  if (items.length === 0 && !empty) return null;
  return (
    <div>
      <span className={"font-semibold " + labelTone}>{label}:</span>{" "}
      {items.length === 0 ? (
        <span className="text-sky-100/50">{empty}</span>
      ) : (
        <ul className="ml-3 mt-0.5 list-disc text-sky-100/70">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Audit table — the machine fields, kept behind the disclosure only.
function CommitteeReadinessAuditTable({ rows }: { rows: CommitteeReadinessAuditRow[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="space-y-1.5 text-[10px]" data-testid="committee-readiness-audit-table">
      <p className="font-mono text-sky-300/60">blocker / task fields</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.blocker_id} className="rounded border border-sky-500/10 bg-black/20 p-1.5">
            <div className="font-mono text-sky-100/70">
              {r.blocker_id} · blocker_type={r.blocker_type} · resolved_status={r.resolved_status}
              {r.impact_status ? ` · impact_status=${r.impact_status}` : ""} · linked_evidence=
              {r.linked_evidence_count}
            </div>
            {r.tasks.length > 0 ? (
              <ul className="ml-3 mt-0.5 space-y-0.5">
                {r.tasks.map((t, i) => (
                  <li key={i} className="font-mono text-sky-100/50">
                    task_type={t.task_type} · resolved_status={t.resolved_status} · review_status=
                    {t.review_status} · committee_grade_accepted={String(t.committee_grade_accepted)} ·
                    auto_clear_forbidden={String(t.auto_clear_forbidden)} · linked_evidence=
                    {t.linked_evidence_count}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// SPEC-BIE-COMMITTEE-EVIDENCE-REQUIREMENTS-ENGINE-1
// Minimal "committee evidence needed" surface: the proactive readiness gaps the
// requirements engine derived from the deal inputs (shown before the gate fails).
const REQ_STATUS_TONE: Record<string, string> = {
  satisfied: "text-emerald-300",
  preliminary_satisfied: "text-sky-300",
  needs_review: "text-amber-300",
  open: "text-amber-100/60",
};

function CommitteeRequirements({ plan }: { plan: CommitteeRequirementsPlan | null }) {
  if (!plan || plan.committee_readiness_gaps.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="committee-requirements">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/80">
        Committee evidence needed
      </p>
      <ul className="space-y-1">
        {plan.committee_readiness_gaps.map((g) => (
          <li key={g.key} className="rounded-lg border border-amber-500/15 bg-black/10 p-2 text-[11px]">
            <div className="flex items-start justify-between gap-2">
              <span className="text-amber-100/80">{g.label}</span>
              <span className={REQ_STATUS_TONE[g.status] ?? "text-amber-100/60"}>
                {g.status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="mt-0.5 text-sky-300/70">{g.recommended_action}</p>
          </li>
        ))}
      </ul>
      {plan.scale_plausibility_plan.applicable ? (
        <p className="text-[10px] text-rose-300/60">
          Scale plausibility requires an explicit analyst conclusion — never auto-clears.
        </p>
      ) : null}
    </div>
  );
}

function CommitteeBlockerResolutions({
  items,
  onReviewTask,
}: {
  items: CommitteeBlockerResolution[];
  onReviewTask?: ReviewTaskHandler;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="committee-blocker-resolutions">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/80">
        Committee blocker resolution
      </p>
      <ul className="space-y-2">
        {items.map((it) => (
          <li
            key={it.blocker_id}
            className="rounded-lg border border-amber-500/20 bg-black/10 p-2.5 text-[11px]"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-amber-100">{it.title}</span>
              <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-300/80">
                {it.blocker_type.replace(/_/g, " ")}
              </span>
            </div>
            <p className="mt-0.5 text-amber-100/60">{it.why_it_blocks_committee}</p>

            {it.existing_supporting_evidence.length > 0 ? (
              <p className="mt-1 text-emerald-300/80">
                Existing evidence:{" "}
                {it.existing_supporting_evidence
                  .map((e) => e.section ?? e.thread_origin ?? "claim")
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(", ")}
              </p>
            ) : (
              <p className="mt-1 text-amber-100/40">Existing evidence: none on file.</p>
            )}

            {it.missing_evidence.length > 0 ? (
              <p className="mt-0.5 text-amber-100/70">
                Needed for committee: {it.missing_evidence.join("; ")}
              </p>
            ) : null}

            {it.recommended_actions.length > 0 ? (
              <p className="mt-0.5 text-sky-300/80">
                Next action: {it.recommended_actions[0]}
              </p>
            ) : null}

            <p className="mt-1 text-amber-100/40">
              {it.can_be_banker_certified_for_preliminary
                ? "Banker-certified/file evidence is sufficient for preliminary."
                : "Cannot be cleared by banker certification."}
              {it.requires_public_or_attested_evidence_for_committee
                ? " Committee requires public/attested evidence."
                : ""}
            </p>

            {/* SPEC-BIE-SOURCE-SNAPSHOT-LEDGER-AND-OFFICIAL-SOURCE-CONNECTORS-1 +
                SPEC-BIE-COMMITTEE-EVIDENCE-COLLECTION-FROM-BLOCKERS-1:
                evidence-collection tasks per blocker, with loan-file linkage. */}
            {it.evidence_tasks && it.evidence_tasks.length > 0 ? (
              <ul className="mt-1.5 space-y-1 border-t border-amber-500/10 pt-1.5">
                {it.evidence_tasks.map((t) => (
                  <EvidenceTaskRow key={t.id ?? t.task_type} task={t} onReviewTask={onReviewTask} />
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceTaskRow({
  task: t,
  onReviewTask,
}: {
  task: CommitteeEvidenceTask;
  onReviewTask?: ReviewTaskHandler;
}) {
  const status = String(t.resolved_status ?? t.status);
  const linkedCount = t.linked_evidence?.length ?? 0;
  return (
    <li className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <TaskStatusDot status={status} />
        <span className="text-amber-100/70">{t.title ?? t.task_type}</span>
        <span className="text-amber-100/40">— {status.replace(/_/g, " ")}</span>
        {linkedCount > 0 ? (
          <span className="text-emerald-300/70">· {linkedCount} on file</span>
        ) : null}
        {t.auto_clear_forbidden ? (
          <span className="text-rose-300/60">· never auto-clears</span>
        ) : null}
        {/* SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1: durable artifact. */}
        {t.artifact_view_url ? (
          <a
            href={t.artifact_view_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-300/80 underline decoration-dotted"
          >
            · View captured source
          </a>
        ) : null}
      </div>
      {t.checklist && t.checklist.length > 0 ? (
        <ul className="ml-4 space-y-0.5">
          {t.checklist.map((c) => (
            <li key={c.label} className="flex items-center gap-1.5 text-amber-100/50">
              <TaskStatusDot status={c.status} />
              <span>{c.label}</span>
              <span className="text-amber-100/30">— {c.status.replace(/_/g, " ")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {/* SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1: review controls + state. */}
      {onReviewTask && t.id ? <TaskReviewControls task={t} onReviewTask={onReviewTask} /> : null}
    </li>
  );
}

// SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1
// Module-scoped (never defined during render). Minimal per-task review controls.
const REVIEW_STATUS_TONE: Record<string, string> = {
  accepted: "text-emerald-300",
  committee_grade: "text-emerald-300",
  rejected: "text-rose-300",
  wrong_entity: "text-rose-300",
  weak_source: "text-amber-300",
  needs_more_evidence: "text-amber-300",
  unreviewed: "text-amber-100/40",
};

// Module-scoped (never created during render — react-hooks/static-components).
function ReviewActionButton({
  onRun,
  label,
  action,
  disabled = false,
  requireReason = false,
  danger = false,
}: {
  onRun: (action: CommitteeReviewAction, requireReason: boolean) => void;
  label: string;
  action: CommitteeReviewAction;
  disabled?: boolean;
  requireReason?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Not available for this task" : undefined}
      onClick={() => onRun(action, requireReason)}
      className={
        "rounded px-1.5 py-0.5 text-[10px] border transition-colors disabled:opacity-30 disabled:cursor-not-allowed " +
        (danger
          ? "border-rose-500/30 text-rose-200/80 hover:bg-rose-500/10"
          : "border-amber-500/20 text-amber-100/70 hover:bg-amber-500/10")
      }
    >
      {label}
    </button>
  );
}

function TaskReviewControls({
  task: t,
  onReviewTask,
}: {
  task: CommitteeEvidenceTask;
  onReviewTask: ReviewTaskHandler;
}) {
  const resolved = String(t.resolved_status ?? t.status ?? "");
  const acceptable = resolved === "collected" || resolved === "needs_review";
  const reviewStatus = String(t.review_status ?? "unreviewed");

  const run = (action: CommitteeReviewAction, requireReason = false) => {
    let reason: string | undefined;
    if (requireReason) {
      const entered = typeof window !== "undefined" ? window.prompt(`Reason for "${action}"?`) : null;
      if (!entered || !entered.trim()) return; // reason mandatory; abort if blank
      reason = entered.trim();
    }
    void onReviewTask(t.id!, action, reason ? { reason } : undefined);
  };

  return (
    <div className="ml-4 mt-0.5 space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <ReviewActionButton onRun={run} label="Accept" action="accept" disabled={!acceptable} />
        <ReviewActionButton
          onRun={run}
          label="Committee-grade"
          action="mark_committee_grade"
          disabled={!acceptable || !!t.auto_clear_forbidden}
        />
        <ReviewActionButton onRun={run} label="Weak source" action="mark_weak_source" />
        <ReviewActionButton onRun={run} label="Wrong entity" action="mark_wrong_entity" requireReason danger />
        <ReviewActionButton onRun={run} label="Request more" action="request_more_evidence" />
        <ReviewActionButton onRun={run} label="Reject" action="reject" requireReason danger />
        <ReviewActionButton onRun={run} label="Reset" action="reset_review" />
      </div>
      {reviewStatus !== "unreviewed" ? (
        <div className="text-[10px]">
          <span className={REVIEW_STATUS_TONE[reviewStatus] ?? "text-amber-100/60"}>
            review: {reviewStatus.replace(/_/g, " ")}
          </span>
          {t.committee_grade_accepted ? (
            <span className="text-emerald-300/70"> · committee-grade accepted</span>
          ) : null}
          {t.review_reason ? (
            <span className="text-amber-100/50"> · reason: {t.review_reason}</span>
          ) : null}
          {t.review_note ? (
            <span className="text-amber-100/50"> · note: {t.review_note}</span>
          ) : null}
          {t.reviewed_by ? (
            <span className="text-amber-100/40"> · by {t.reviewed_by}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TaskStatusDot({ status }: { status: string }) {
  const tone =
    status === "accepted" || status === "collected"
      ? "text-emerald-300"
      : status === "rejected"
        ? "text-rose-300"
        : status === "needs_review"
          ? "text-amber-300"
          : "text-amber-300/60"; // missing | pending
  const glyph =
    status === "accepted" || status === "collected"
      ? "✓"
      : status === "rejected"
        ? "✗"
        : status === "needs_review"
          ? "~"
          : "•";
  return <span className={tone} aria-label={status}>{glyph}</span>;
}

// SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
function GateGroup({
  title,
  items,
  presentTone = false,
}: {
  title: string;
  items: ResearchGateGroupItem[];
  presentTone?: boolean;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/80">{title}</p>
      <ul className="space-y-1">
        {items.map((it, i) => {
          const dot =
            it.status === "present" ? "✓" : it.status === "advisory" ? "•" : "✗";
          const tone =
            it.status === "present"
              ? "text-emerald-300/90"
              : it.status === "advisory"
                ? "text-amber-200/70"
                : "text-amber-100/90";
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 ${tone}`}>{dot}</span>
              <span className="flex-1">
                <span className={tone}>{it.label}</span>
                {it.blocksCommittee && it.status !== "present" ? (
                  <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] text-amber-300/80">
                    committee
                  </span>
                ) : null}
                <span className="block text-amber-100/50">{it.meaning}</span>
                {it.actionApi && !presentTone ? (
                  <a href={it.actionApi} className="text-sky-300/80 underline">
                    Fix in Memo Inputs →
                  </a>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
