/**
 * GET /api/cron/crm-automation?run=<trigger-key>|sequences&bankId=<id>
 *
 * PR4's automation/sequence execution mechanism — one more entry in the
 * existing checker-cron family (mirrors /api/cron/sba-checks) rather than
 * a new scheduler. Auth: CRON_SECRET or WORKER_SECRET via
 * hasValidWorkerSecret, same as every other cron/worker route here.
 *
 * run=lead_stale | task_overdue | condition_overdue |
 *     lender_response_missing | referral_relationship_stale |
 *     document_missing  — runs one automation trigger
 * run=sequences          — advances all due sequence steps
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { runAutomationTrigger, AUTOMATION_TRIGGERS, type AutomationTriggerKey } from "@/lib/automation/run";
import { advanceSequences } from "@/lib/sequences/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const start = Date.now();

  if (!hasValidWorkerSecret(req)) {
    console.error("[cron/crm-automation] auth_failed");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const run = new URL(req.url).searchParams.get("run") ?? "";
  const bankId = new URL(req.url).searchParams.get("bankId") ?? (await getBrokerageBankId());
  const sb = supabaseAdmin();

  try {
    if (run === "sequences") {
      const result = await advanceSequences(bankId, sb as any);
      return NextResponse.json({ ok: true, run, result, durationMs: Date.now() - start });
    }
    if ((AUTOMATION_TRIGGERS as readonly string[]).includes(run)) {
      const result = await runAutomationTrigger(bankId, run as AutomationTriggerKey, sb as any);
      return NextResponse.json({ ok: true, run, result, durationMs: Date.now() - start });
    }
    return NextResponse.json({ ok: false, error: `unknown run: ${run}. Must be 'sequences' or one of: ${AUTOMATION_TRIGGERS.join(", ")}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/crm-automation] run_failed", { run, error: msg });
    return NextResponse.json({ ok: false, run, error: msg, durationMs: Date.now() - start }, { status: 500 });
  }
}
