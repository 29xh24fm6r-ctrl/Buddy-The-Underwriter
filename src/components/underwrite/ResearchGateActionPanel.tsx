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
} from "./researchGateTypes";
import { deriveResearchGatePhase, deriveDecisionReadiness } from "./researchGatePhase";

interface Props {
  snapshot: ResearchGateSnapshot;
  workspaceReady: boolean;
  pending: ResearchGatePending;
  onInitialize: () => void;
  onRunResearch: () => void;
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
        <CommitteeBlockerResolutions items={snapshot.committeeBlockerResolutions} />
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
function CommitteeBlockerResolutions({ items }: { items: CommitteeBlockerResolution[] }) {
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
          </li>
        ))}
      </ul>
    </div>
  );
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
