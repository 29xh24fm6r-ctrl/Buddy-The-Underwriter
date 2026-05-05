"use client";

import type { ReactNode } from "react";
import type { LifecycleBlocker, LifecycleStage } from "@/buddy/lifecycle/model";
import { STAGE_LABELS } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { PrimaryActionBar } from "./PrimaryActionBar";
import { StageBlockerList } from "./StageBlockerList";

/**
 * Common layout for every stage view:
 *   1. stage title block
 *   2. exactly one PrimaryActionBar (single source of truth — shared across stages)
 *   3. stage-specific content
 *   4. stage-specific blockers (`StageBlockerList`)
 *   5. optional "Advanced" disclosure (each stage view passes its own children)
 */
export function StageWorkspaceShell({
  stage,
  dealId,
  action,
  blockers,
  subtitle,
  children,
  advanced,
}: {
  stage: LifecycleStage | null;
  dealId: string;
  action: NextAction | null;
  blockers: LifecycleBlocker[];
  subtitle?: string;
  children: ReactNode;
  advanced?: ReactNode;
}) {
  const stageLabel = stage ? STAGE_LABELS[stage] ?? stage : "Loading…";

  return (
    <div
      data-testid="stage-workspace-shell"
      data-stage={stage ?? "unknown"}
      className="space-y-4"
    >
      <header className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
          Current stage
        </span>
        <h2 className="text-xl font-semibold text-white">{stageLabel}</h2>
        {subtitle ? <p className="text-sm text-white/60">{subtitle}</p> : null}
      </header>

      <PrimaryActionBar action={action} dealId={dealId} />

      <div className="space-y-4">{children}</div>

      <StageBlockerList dealId={dealId} blockers={blockers} />

      {advanced ?? null}
    </div>
  );
}
