// Server-only event hook: refresh readiness whenever a banker-meaningful
// event fires (document finalized, fact written, research complete,
// memo-input upsert, conflict resolved, etc).
//
// Design notes:
//   • Fire-and-forget by default. Callers should not block their own
//     critical path on readiness recomputation. Use `await` only when the
//     caller specifically needs the new readiness object (e.g. the
//     /readiness/refresh route).
//   • Idempotent. Re-running with no underlying state change is a no-op.
//   • Single source of truth. Every event hook in the codebase routes
//     through this helper — no scattered refresh logic elsewhere.
//   • Always succeeds from the caller's perspective. Internal failures are
//     swallowed and logged so a transient readiness recompute glitch can
//     never break document finalize, research completion, etc.
//
// CI guard `perfectBankerFlowV11Guard.test.ts` enforces that all known
// event hooks reference this module.

import "server-only";

import { buildUnifiedDealReadiness } from "./buildUnifiedDealReadiness";
import { reconcileDealLifecycle } from "./reconcileDealLifecycle";
import type { UnifiedDealReadiness } from "./types";

export type ReadinessEventTrigger =
  | "document_finalized"
  | "artifact_completed"
  | "financial_facts_written"
  | "spreads_completed"
  | "research_completed"
  | "borrower_story_updated"
  | "management_updated"
  | "collateral_updated"
  | "conflict_resolved"
  | "credit_memo_submitted"
  | "policy_exception_resolved"
  | "manual";

export type RefreshDealReadinessArgs = {
  dealId: string;
  trigger: ReadinessEventTrigger;
  // When provided, the lifecycle reconciler runs and may advance the
  // deal's stage to memo_inputs_required / underwrite_ready. Defaults to
  // true. Set false from very-high-frequency callers (per-fact-write loops).
  reconcile?: boolean;
  // Identifier of the user / system actor that caused the event. Required
  // when reconcile=true so any auto-advance ledger writes carry an actor.
  actorId?: string;
};

export type RefreshDealReadinessResult =
  | {
      ok: true;
      readiness: UnifiedDealReadiness;
      reconciled: { fromStage: string; toStage: string | null; advanced: boolean };
    }
  | { ok: false; reason: string };

/**
 * Recompute UnifiedDealReadiness for a deal and (optionally) reconcile its
 * lifecycle stage. Caller may `await` for the result or fire-and-forget.
 */
export async function refreshDealReadiness(
  args: RefreshDealReadinessArgs,
): Promise<RefreshDealReadinessResult> {
  try {
    const built = await buildUnifiedDealReadiness({
      dealId: args.dealId,
      runReconciliation: true,
      runSelfHeal: true,
    });
    if (!built.ok) {
      logFailure(args, built.reason);
      return { ok: false, reason: built.reason };
    }

    let reconciled = {
      fromStage: built.readiness.stage as string,
      toStage: null as string | null,
      advanced: false,
    };

    if (args.reconcile !== false) {
      try {
        const r = await reconcileDealLifecycle({
          dealId: args.dealId,
          readiness: built.readiness,
          bankerId: args.actorId ?? "system:readiness_refresh",
        });
        reconciled = {
          fromStage: r.fromStage as string,
          toStage: (r.toStage as string | null) ?? null,
          advanced: r.advanced,
        };
      } catch (e) {
        // Reconciler failure is non-fatal — the readiness object is still
        // returned to callers. The lifecycle_reconcile_failed blocker is
        // surfaced on the next /readiness GET (see blockers in v1.1).
        logFailure(args, `reconcile_failed:${stringifyError(e)}`);
      }
    }

    return { ok: true, readiness: built.readiness, reconciled };
  } catch (e) {
    logFailure(args, stringifyError(e));
    return { ok: false, reason: stringifyError(e) };
  }
}

/**
 * Fire-and-forget variant. Use from event-handler callers that should
 * never wait on readiness recomputation. Errors are logged, never thrown.
 */
export function scheduleReadinessRefresh(args: RefreshDealReadinessArgs): void {
  // Detach with `void` so the caller's microtask returns immediately. We
  // still attach a `.catch` so unhandled-rejection warnings don't surface.
  void refreshDealReadiness(args).catch((e) => logFailure(args, stringifyError(e)));
}

function logFailure(args: RefreshDealReadinessArgs, reason: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[refreshDealReadiness] non-fatal failure dealId=${args.dealId} trigger=${args.trigger} reason=${reason}`,
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
