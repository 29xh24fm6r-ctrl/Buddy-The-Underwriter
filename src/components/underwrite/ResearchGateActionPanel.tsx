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

import type { ResearchGateSnapshot, ResearchGatePending } from "./researchGateTypes";
import { deriveResearchGatePhase } from "./researchGatePhase";

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
          Research has not been run for this deal. Buddy needs a committee-grade
          research mission before the memo can clear the research quality gate.
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
  return (
    <Shell>
      <div className="space-y-2 text-sm">
        <p className="font-medium text-amber-100">
          Research completed but did not clear the quality gate.
        </p>
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
        {snapshot.gateFailures.length > 0 ? (
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
