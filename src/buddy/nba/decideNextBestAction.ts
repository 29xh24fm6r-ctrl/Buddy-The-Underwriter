import type { BuddyContextPack } from "@/buddy/brain/types";
import type { NBASuggestion } from "@/buddy/nba/types";
import { shouldSuggestNudge } from "@/buddy/nudge/nudgeRules";

export function decideNextBestAction(
  ctx: BuddyContextPack,
  lastNudgeAtIso?: string | null
): NBASuggestion | null {
  const role = ctx.role;
  const checklist = ctx.checklist;

  if (!checklist) return null;

  const missing = Number(checklist.missing ?? NaN);
  const received = Number(checklist.received ?? NaN);

  if (role === "borrower") {
    if (Number.isFinite(missing) && missing > 0) {
      return {
        reason: `You still have ${missing} document${missing === 1 ? "" : "s"} left to upload.`,
        actions: [{ id: "upload_docs", label: "Upload documents" }],
      };
    }

    return {
      reason: "Your documents look complete.",
      actions: [],
    };
  }

  if (Number.isFinite(missing) && missing > 0) {
    const allowNudge = shouldSuggestNudge(ctx, lastNudgeAtIso ?? null);
    return {
      reason: `Checklist incomplete (${received || 0} received, ${missing} missing).`,
      actions: [
        {
          id: "request_missing_docs",
          label: "Request missing docs",
          payload: { dealId: ctx.dealId },
        },
        {
          id: "send_borrower_nudge" as const,
          label: "Nudge borrower",
          description: allowNudge ? "Send a soft SMS reminder" : "Cooldown active — wait before nudging again",
          payload: { dealId: ctx.dealId },
        },
        {
          id: "run_reconcile",
          label: "Run checklist reconcile",
          payload: { dealId: ctx.dealId },
        },
      ],
    };
  }

  return {
    reason: "Checklist complete. Ready to proceed.",
    actions: [
      {
        id: "start_underwriting",
        label: "Start underwriting",
        payload: { dealId: ctx.dealId },
      },
    ],
  };
}
