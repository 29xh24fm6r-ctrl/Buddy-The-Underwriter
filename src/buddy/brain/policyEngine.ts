import type { BuddyContextPack, BuddyReply } from "@/buddy/brain/types";

export function decideReply(ctx: BuddyContextPack): BuddyReply | null {
  const recent = ctx.recentSignals ?? [];
  const last = recent[recent.length - 1];

  if (!last) return null;

  if (last.type === "error") {
    return {
      intent: ctx.role === "builder" ? "debug" : "warn",
      message:
        ctx.role === "borrower"
          ? "Something didn’t work on that step. Try again—if it keeps failing, tell your banker and I’ll log the details."
          : "An error occurred in this flow. Check the timeline for details.",
    };
  }

  if (last.type === "checklist.updated") {
    const missing = Number(last.payload?.missing ?? NaN);
    const received = Number(last.payload?.received ?? NaN);

    if (ctx.role === "borrower") {
      if (Number.isFinite(missing) && missing > 0) {
        return {
          intent: "next_steps",
          message: `Thanks — I received ${Number.isFinite(received) ? received : "some"} documents. We still need ${missing}. Upload the missing items when ready.`,
        };
      }
      return {
        intent: "reassure",
        message: "Nice — your checklist looks complete. Your banker can move forward.",
      };
    }

    if (Number.isFinite(missing) && missing > 0) {
      return {
        intent: "next_steps",
        message: `Checklist update: ${Number.isFinite(received) ? received : "?"} received · ${missing} missing. Next best action: request the missing docs.`,
        actions: [{ id: "request_missing_docs", label: "Request missing docs", payload: { dealId: ctx.dealId } }],
      };
    }
    return { intent: "reassure", message: "Checklist complete. Ready for underwriting review." };
  }

  if (last.type === "user.action" && last.payload?.action === "start_underwriting") {
    return {
      intent: "reassure",
      message: "Starting underwriting. I’ll watch for missing docs and pipeline errors.",
    };
  }

  if (ctx.role === "builder") {
    return { intent: "debug", message: `signal: ${last.type} · ${last.source}` };
  }

  return null;
}
