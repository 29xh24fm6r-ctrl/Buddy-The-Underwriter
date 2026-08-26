import "server-only";

/**
 * Admit a Golden Trident run and hand it to the durable workflow.
 *
 * Every trigger surface routes through here so generation has one lifecycle.
 * Previously the staff route started the durable workflow while the two
 * borrower-facing surfaces — the concierge and the voice dispatcher — awaited
 * `generateTridentBundle` inline inside a 300s request, because at the time
 * fire-and-forget was the only alternative and it does not survive serverless
 * shutdown. The durable workflow removes that trade-off: the request returns
 * immediately and the run continues outside it.
 *
 * That inline await was a live reliability problem for preview generation. A
 * preview run performs LLM business-plan generation, an AI verifier pass, the
 * feasibility engine, and several PDF renders and storage round-trips. When
 * that exceeded the ceiling the function was reclaimed mid-run, leaving the
 * bundle holding a 90-minute lease in `running` — during which
 * `acquire_trident_bundle_run` reports `reused` and every retry is refused,
 * so the borrower could not regenerate until the janitor reconciled it.
 *
 * The borrower's chat reply never depended on the result: it is a fixed
 * string, and artifacts are fetched separately from `latest-preview`.
 */

import { start } from "workflow/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  createTridentBundleRun,
  type TridentBundleMode,
} from "@/lib/brokerage/trident/generateTridentBundle";
import { goldenTridentWorkflow } from "@/workflows/goldenTrident";

export type StartTridentGenerationResult =
  | { ok: true; accepted: true; bundleId: string; runId: string; alreadyRunning?: false }
  | { ok: true; accepted: true; bundleId: string; alreadyRunning: true; runId?: undefined }
  | { ok: false; bundleId: string | null; error: string };

export async function startTridentGeneration(args: {
  dealId: string;
  mode: TridentBundleMode;
}): Promise<StartTridentGenerationResult> {
  const { dealId, mode } = args;

  const created = await createTridentBundleRun({ dealId, mode });
  if (!created.ok) return { ok: false, bundleId: null, error: created.error };

  // An active lease already covers this (deal, mode). Admission is atomic, so
  // this is the correct answer rather than a race to be retried.
  if (created.reused) {
    return { ok: true, accepted: true, bundleId: created.bundleId, alreadyRunning: true };
  }

  const sb = supabaseAdmin();
  let run: Awaited<ReturnType<typeof start>>;
  try {
    run = await start(goldenTridentWorkflow, [
      {
        dealId,
        mode,
        bundleId: created.bundleId,
        leaseToken: created.leaseToken,
      },
    ]);
  } catch (error) {
    // The admission succeeded but the durable run did not start. Only this
    // failure is allowed to release the lease. Once start() returns, the
    // workflow owns the bundle and may already be executing; marking it failed
    // after a tracking-write error would admit a duplicate generation.
    const message = error instanceof Error ? error.message : String(error);
    let releaseErrorMessage: string | null = null;
    try {
      const { error: releaseError } = await sb.rpc("fail_trident_bundle_run", {
        p_bundle_id: created.bundleId,
        p_lease_token: created.leaseToken,
        p_input_hash: created.inputHash,
        p_error: `Workflow start failed: ${message}`,
      });
      releaseErrorMessage = releaseError?.message ?? null;
    } catch (releaseError) {
      releaseErrorMessage =
        releaseError instanceof Error ? releaseError.message : String(releaseError);
    }

    if (releaseErrorMessage) {
      // The durable run never started, but the admission lease may remain live.
      // Surface that distinct condition instead of silently reporting only the
      // start failure and making the next request appear mysteriously reused.
      console.error("[trident] workflow start failed and lease release failed", {
        bundleId: created.bundleId,
        startError: message,
        releaseError: releaseErrorMessage,
      });
      return {
        ok: false,
        bundleId: created.bundleId,
        error: `${message} (lease cleanup failed; retry after reconciliation)`,
      };
    }

    return { ok: false, bundleId: created.bundleId, error: message };
  }

  const { error: runPersistError } = await sb
    .from("buddy_trident_bundles")
    .update({ workflow_run_id: run.runId, last_heartbeat_at: new Date().toISOString() })
    .eq("id", created.bundleId)
    .eq("lease_token", created.leaseToken);
  if (runPersistError) {
    // The durable workflow is already running. Preserve its lease and return
    // the run identity to the caller; failing the bundle here would allow a
    // retry to start a second workflow against the same deal and mode.
    console.error("[trident] workflow started but identity persistence failed", {
      bundleId: created.bundleId,
      runId: run.runId,
      error: runPersistError.message,
    });
  }

  return { ok: true, accepted: true, bundleId: created.bundleId, runId: run.runId };
}
