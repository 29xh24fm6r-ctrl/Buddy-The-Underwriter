"use client";

import { getDealIdFromPath } from "@/buddy/getDealIdFromPath";
import type { BuddyContextPack } from "@/buddy/brain/types";
import type { BuddySessionState } from "@/buddy/memory/buddySessionStore";

export function buildContextPack(args: {
  state: BuddySessionState;
  path: string;
}): BuddyContextPack {
  const { state, path } = args;
  const dealId = getDealIdFromPath(path);
  const recentSignals = (state.signals ?? []).slice(-50);
  const lastChecklist = [...recentSignals].reverse().find((s: any) => s.type === "checklist.updated");

  return {
    role: state.role,
    path,
    dealId,
    checklist: lastChecklist?.payload
      ? {
          received: lastChecklist.payload.received,
          missing: lastChecklist.payload.missing,
          missingKeys: lastChecklist.payload.missingKeys,
        }
      : undefined,
    deal: undefined,
    recentSignals,
  };
}
