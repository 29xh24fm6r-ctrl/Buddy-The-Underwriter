"use client";

import { useMemo } from "react";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { ArtifactsSummary } from "@/buddy/cockpit/useCockpitData";
import { getNextAction, getNextActionIcon, type NextAction, type ServerActionType } from "@/buddy/lifecycle/nextAction";

export type PrimaryCTAIntent =
  | "recognize"
  | "processing"
  | "advance"
  | "navigate"
  | "runnable"
  | "blocked"
  | "complete"
  | "loading";

export type PrimaryCTA = {
  label: string;
  intent: PrimaryCTAIntent;
  disabled: boolean;
  icon: string;
  animate?: boolean;
  description?: string;
  href?: string;
  serverAction?: ServerActionType;
  shouldAdvance?: boolean;
};

export function usePrimaryCTA(
  dealId: string,
  lifecycleState: LifecycleState | null,
  artifactSummary: ArtifactsSummary | null,
  isProcessing: boolean,
): PrimaryCTA {
  return useMemo(() => {
    // Priority 1: Currently processing artifacts
    if (isProcessing) {
      return {
        label: "Recognizing Documents...",
        intent: "processing" as const,
        disabled: true,
        icon: "progress_activity",
        animate: true,
        description: "AI is classifying your documents",
      };
    }

    // Priority 2: Unclassified docs exist — RECOGNIZE DOCUMENTS
    const totalFiles = artifactSummary?.total_files ?? 0;
    const queued = artifactSummary?.queued ?? 0;
    const processing = artifactSummary?.processing ?? 0;
    const matched = artifactSummary?.matched ?? 0;
    const hasFiles = totalFiles > 0;
    const hasUnclassified = queued > 0 || processing > 0 || (hasFiles && totalFiles > matched);

    if (hasFiles && hasUnclassified) {
      const waiting = queued + processing;
      return {
        label: "Recognize Documents",
        intent: "recognize" as const,
        disabled: false,
        icon: "auto_awesome",
        description: waiting > 0
          ? `${waiting} document${waiting !== 1 ? "s" : ""} waiting for classification`
          : `${totalFiles - matched} unclassified document${totalFiles - matched !== 1 ? "s" : ""}`,
      };
    }

    // Priority 3: Fall through to lifecycle-based next action
    if (lifecycleState) {
      const nextAction: NextAction = getNextAction(lifecycleState, dealId);
      return {
        label: nextAction.label,
        intent: nextAction.intent as PrimaryCTAIntent,
        disabled: nextAction.intent === "blocked" || nextAction.intent === "complete",
        icon: getNextActionIcon(nextAction.intent),
        description: nextAction.description,
        href: nextAction.href,
        serverAction: nextAction.serverAction,
        shouldAdvance: nextAction.shouldAdvance,
      };
    }

    // Fallback: loading
    return {
      label: "Loading...",
      intent: "loading" as const,
      disabled: true,
      icon: "hourglass_empty",
    };
  }, [dealId, lifecycleState, artifactSummary, isProcessing]);
}
