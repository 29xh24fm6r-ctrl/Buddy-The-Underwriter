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
  try {
    const run = await start(goldenTridentWorkflow, [
      {
        dealId,
        mode,
        bundleId: created.bundleId,
        leaseToken: created.leaseToken,
      },
    ]);

    const { error: runPersistError } = await sb
      .from("buddy_trident_bundles")
      .update({ workflow_run_id: run.runId, last_heartbeat_at: new Date().toISOString() })
      .eq("id", created.bundleId)
      .eq("lease_token", created.leaseToken);
    if (runPersistError) {
      throw new Error(`Workflow identity persistence failed: ${runPersistError.message}`);
    }

    return { ok: true, accepted: true, bundleId: created.bundleId, runId: run.runId };
  } catch (error) {
    // The admission succeeded but the run did not start. Release the lease
    // now rather than leaving it to expire, so the borrower can retry
    // immediately instead of waiting out the janitor.
    const message = error instanceof Error ? error.message : String(error);
    const { data: admitted } = await sb
      .from("buddy_trident_bundles")
      .select("input_hash")
      .eq("id", created.bundleId)
      .eq("lease_token", created.leaseToken)
      .maybeSingle();
    if (admitted?.input_hash) {
      await sb.rpc("fail_trident_bundle_run", {
        p_bundle_id: created.bundleId,
        p_lease_token: created.leaseToken,
        p_input_hash: admitted.input_hash,
        p_error: `Workflow start failed: ${message}`,
      });
    }
    return { ok: false, bundleId: created.bundleId, error: message };
  }
}
