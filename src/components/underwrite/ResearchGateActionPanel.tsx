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

import type {
  ResearchGateSnapshot,
  ResearchGatePending,
  ResearchGateGroupItem,
  CommitteeBlockerResolution,
  CommitteeEvidenceTask,
  CommitteeReviewAction,
  CommitteeRequirementsPlan,
  ReviewTaskHandler,
} from "./researchGateTypes";
import {
  deriveResearchGatePhase,
  deriveDecisionReadiness,
  shouldShowCommitteeReadiness,
} from "./researchGatePhase";
// SPEC-BIE-COMMITTEE-READINESS-UX-SIMPLIFICATION-1: banker-facing view-model.
import {
  buildCommitteeReadinessView,
  type CommitteeReadinessSummaryView,
  type CommitteeReadinessGroupView,
  type ScalePlausibilityView,
  type CommitteeReadinessAuditRow,
  type GroupStatusLabel,
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
}: {
  snapshot: ResearchGateSnapshot;
  onReviewTask?: ReviewTaskHandler;
}) {
  if (!shouldShowCommitteeReadiness(snapshot)) return null;
  // SPEC-BIE-COMMITTEE-READINESS-UX-SIMPLIFICATION-1: banker-simple default view.
  const view = buildCommitteeReadinessView(snapshot);
  if (!view) return null;
  return (
    <div
      data-testid="committee-readiness-panel"
      className="rounded-xl border border-sky-500/20 bg-sky-500/[0.05] p-5 space-y-4"
    >
      <CommitteeReadinessSummaryCard summary={view.summary} />

      <div className="space-y-2" data-testid="committee-readiness-groups">
        {view.groups.map((g) => (
          <CommitteeReadinessGroupCard key={g.id} group={g} />
        ))}
      </div>

      {view.scalePlausibility ? (
        <ScalePlausibilityCallout scale={view.scalePlausibility} />
      ) : null}

      {/* Advanced technical fields live behind a disclosure; the default view
          stays banker-simple. The full evidence-task review controls remain
          available here so reviewers can still act on each task. */}
      <details
        data-testid="committee-readiness-audit"
        className="rounded-lg border border-sky-500/15 bg-black/10 p-3"
      >
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-sky-300/70">
          Show audit details
        </summary>
        <div className="mt-3 space-y-3">
          <CommitteeReadinessAuditTable rows={view.audit} />
          <CommitteeBlockerResolutions
            items={snapshot.committeeBlockerResolutions}
            onReviewTask={onReviewTask}
          />
          <CommitteeRequirements plan={snapshot.committeeRequirementsPlan} />
        </div>
      </details>
    </div>
  );
}

// SPEC-BIE-COMMITTEE-READINESS-UX-SIMPLIFICATION-1
// Top summary card: where we stand + 3 counters + one prioritized next action.
function CommitteeReadinessSummaryCard({
  summary,
}: {
  summary: CommitteeReadinessSummaryView;
}) {
  return (
    <div className="space-y-3" data-testid="committee-readiness-summary">
      <div className="flex items-center gap-2">
        <span
          className={
            "inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold uppercase tracking-wide " +
            (summary.committeeReady
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300")
          }
        >
          {summary.committeeStatusLabel}
        </span>
        <h2 className="text-sm font-semibold text-sky-100">Committee readiness</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className={summary.preliminaryClear ? "text-emerald-300" : "text-amber-300"}>
          {summary.preliminaryClear ? "✓ " : ""}
          {summary.preliminaryStatusLabel}
        </span>
        <span className="text-sky-100/40">·</span>
        <span className={summary.committeeReady ? "text-emerald-300" : "text-amber-300"}>
          {summary.committeeStatusLabel}
        </span>
      </div>

      <p className="text-sm text-sky-100/80">{summary.subcopy}</p>

      <div className="flex flex-wrap gap-2">
        <CounterChip label="Ready for committee" value={summary.counters.ready} tone="ready" />
        <CounterChip label="Needs review" value={summary.counters.needsReview} tone="review" />
        <CounterChip label="Missing" value={summary.counters.missing} tone="missing" />
      </div>

      {summary.nextBestAction ? (
        <div
          className="rounded-lg border border-sky-400/30 bg-sky-500/10 p-2.5"
          data-testid="committee-next-best-action"
        >
          <p className="text-[11px]">
            <span className="font-semibold text-sky-200">Next best action: </span>
            <span className="text-sky-100/90">{summary.nextBestAction}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function CounterChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ready" | "review" | "missing";
}) {
  const toneClass =
    tone === "ready"
      ? "border-emerald-500/30 text-emerald-200"
      : tone === "review"
        ? "border-amber-500/30 text-amber-200"
        : "border-rose-500/30 text-rose-200";
  return (
    <span
      className={"rounded-lg border bg-black/10 px-2.5 py-1 text-[11px] " + toneClass}
    >
      {label}: <span className="font-semibold">{value}</span>
    </span>
  );
}

const GROUP_STATUS_TONE: Record<GroupStatusLabel, string> = {
  Complete: "bg-emerald-500/15 text-emerald-300",
  "Needs review": "bg-amber-500/15 text-amber-300",
  "Needs analyst conclusion": "bg-rose-500/15 text-rose-200",
  Missing: "bg-rose-500/15 text-rose-200",
};

// One of the 5 human-readable evidence groups.
function CommitteeReadinessGroupCard({ group }: { group: CommitteeReadinessGroupView }) {
  return (
    <div
      className="rounded-lg border border-sky-500/15 bg-black/10 p-3 text-[11px]"
      data-testid={`committee-group-${group.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-sky-100">{group.title}</span>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
            GROUP_STATUS_TONE[group.status]
          }
          data-testid={`committee-group-${group.id}-status`}
        >
          {group.status}
        </span>
      </div>
      <p className="mt-1 text-sky-100/70">{group.explanation}</p>

      {group.alreadyOnFile.length > 0 ? (
        <div className="mt-1.5" data-testid={`committee-group-${group.id}-onfile`}>
          <p className="text-emerald-300/70">Already on file:</p>
          <ul className="ml-3 list-disc text-sky-100/60">
            {group.alreadyOnFile.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {group.needsReview.length > 0 ? (
        <div className="mt-1.5" data-testid={`committee-group-${group.id}-needsreview`}>
          <p className="text-sky-300/70">Needs review:</p>
          <ul className="ml-3 list-disc text-sky-100/60">
            {group.needsReview.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {group.missing.length > 0 ? (
        <div className="mt-1.5" data-testid={`committee-group-${group.id}-missing`}>
          <p className="text-amber-300/70">Missing:</p>
          <ul className="ml-3 list-disc text-sky-100/60">
            {group.missing.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {group.capturedSources.length > 0 ? (
        <div className="mt-1.5" data-testid={`committee-group-${group.id}-captured`}>
          <p className="text-sky-300/70">Captured sources:</p>
          <ul className="ml-3 list-disc text-sky-100/60">
            {group.capturedSources.map((s, i) => (
              <li key={i}>
                {s.label} —{" "}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300/90 underline decoration-dotted"
                >
                  View captured source
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {group.nextAction ? (
        <p className="mt-1.5 text-sky-300/80">Next action: {group.nextAction}</p>
      ) : null}
    </div>
  );
}

// Scale plausibility rendered as an analyst conclusion, never a raw contradiction.
function ScalePlausibilityCallout({ scale }: { scale: ScalePlausibilityView }) {
  return (
    <div
      className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-3 text-[11px]"
      data-testid="committee-scale-plausibility"
    >
      <p className="text-sm font-medium text-rose-100">{scale.label}</p>
      <p className="mt-1 text-rose-100/70">{scale.explanation}</p>
      <p className="mt-1.5 text-sky-300/80">Next action: {scale.nextAction}</p>
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
