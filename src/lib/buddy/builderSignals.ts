import "server-only";

import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";

/**
 * Builder Observer instrumentation (build mode only).
 * Release-mode narration should use a separate channel and copy path.
 */
export async function emitBuilderLifecycleSignal(args: {
  dealId: string;
  phase: "intake" | string;
  state: "initialized" | "already_initialized" | "failed" | string;
  trigger: string;
  checklistCount?: number;
  note?: string;
}) {
  if (process.env.BUDDY_BUILDER_MODE !== "1") return;

  try {
    await emitBuddySignalServer({
      type: "lifecycle",
      source: "lib/buddy/builderSignals",
      ts: Date.now(),
      dealId: args.dealId,
      payload: {
        dealId: args.dealId,
        phase: args.phase,
        state: args.state,
        trigger: args.trigger,
        checklistCount: args.checklistCount ?? null,
        note: args.note ?? null,
      },
    });
  } catch (e: any) {
    console.warn("[builderSignals] emit failed", {
      dealId: args.dealId,
      error: e?.message ?? String(e),
    });
  }
}
