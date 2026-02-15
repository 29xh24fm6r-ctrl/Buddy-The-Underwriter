"use client";

import { useMemo } from "react";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { ArtifactsSummary } from "@/buddy/cockpit/useCockpitData";
import { getNextAction, getNextActionIcon, type NextAction, type ServerActionType } from "@/buddy/lifecycle/nextAction";

export type CockpitPhase = "UPLOADING" | "PROCESSING" | "READY" | "BLOCKED";

export type PrimaryCTAIntent =
  | "recognize_retry"
  | "processing"
  | "advance"
  | "navigate"
  | "runnable"
  | "blocked"
  | "complete"
  | "loading"
  | "upload";

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

/**
 * Derive the cockpit phase from available data.
 *
 * - UPLOADING: no docs yet
 * - PROCESSING: artifacts are actively queued or being classified
 * - READY: all required checklist items satisfied
 * - BLOCKED: classified but missing required items
 *
 * Invariants:
 * - PROCESSING only when artifacts are genuinely in-flight (queued/processing > 0)
 * - Blockers and spinner must NEVER coexist — blockers take priority
 * - "classified but not matched" is NOT processing (it's a terminal state for that artifact)
 */
export function deriveCockpitPhase(
  artifactSummary: ArtifactsSummary | null,
  lifecycleState: LifecycleState | null,
): CockpitPhase {
  const totalFiles = artifactSummary?.total_files ?? 0;
  if (totalFiles === 0) return "UPLOADING";

  // Only genuinely in-flight artifacts count as processing.
  // `totalFiles > matched` is NOT used — classified-but-unmatched is a terminal state.
  const queued = artifactSummary?.queued ?? 0;
  const processing = artifactSummary?.processing ?? 0;
  const activelyProcessing = queued > 0 || processing > 0;

  // Blockers take absolute priority — never show spinner alongside blockers
  const hasBlockers = (lifecycleState?.blockers?.length ?? 0) > 0;
  if (hasBlockers) return "BLOCKED";

  if (activelyProcessing) return "PROCESSING";

  const allSatisfied = lifecycleState?.derived?.documentsReady ?? false;
  return allSatisfied ? "READY" : "BLOCKED";
}

export function usePrimaryCTA(
  dealId: string,
  lifecycleState: LifecycleState | null,
  artifactSummary: ArtifactsSummary | null,
  isProcessing: boolean,
): PrimaryCTA {
  return useMemo(() => {
    const phase = deriveCockpitPhase(artifactSummary, lifecycleState);

    // UPLOADING — no docs yet
    if (phase === "UPLOADING") {
      return {
        label: "Upload Documents",
        intent: "upload" as const,
        disabled: false,
        icon: "upload_file",
        description: "Upload borrower documents to begin",
        href: `/deals/${dealId}/cockpit?focus=documents`,
      };
    }

    // PROCESSING — automatic recognition in progress
    // Never show spinner when blockers exist (phase would be BLOCKED)
    if (phase === "PROCESSING" || (isProcessing && phase !== "BLOCKED")) {
      const queued = (artifactSummary?.queued ?? 0) + (artifactSummary?.processing ?? 0);
      return {
        label: "Recognizing Documents...",
        intent: "processing" as const,
        disabled: true,
        icon: "progress_activity",
        animate: true,
        description: queued > 0
          ? `${queued} document${queued !== 1 ? "s" : ""} being classified`
          : "AI is classifying your documents",
      };
    }

    // Failed artifacts exist — offer retry
    const failed = artifactSummary?.failed ?? 0;
    if (failed > 0) {
      return {
        label: "Retry Failed Documents",
        intent: "recognize_retry" as const,
        disabled: false,
        icon: "refresh",
        description: `${failed} document${failed !== 1 ? "s" : ""} failed classification`,
      };
    }

    // BLOCKED — check document completeness or generic blocker
    if (phase === "BLOCKED") {
      const docsReady = lifecycleState?.derived?.documentsReady ?? false;
      if (!docsReady) {
        const pct = lifecycleState?.derived?.documentsReadinessPct ?? 0;
        return {
          label: "Upload Missing Documents",
          intent: "navigate" as const,
          disabled: false,
          icon: "upload_file",
          description: `AI document readiness at ${Math.round(pct)}%`,
          href: `/deals/${dealId}/cockpit?focus=documents`,
        };
      }
      // Generic blocked
      return {
        label: "Resolve Blockers",
        intent: "blocked" as const,
        disabled: true,
        icon: "block",
        description: `${lifecycleState?.blockers?.length ?? 0} issue(s) blocking advancement`,
      };
    }

    // READY — fall through to lifecycle-based next action
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
