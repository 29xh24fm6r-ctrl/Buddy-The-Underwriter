import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { startAutopilotRun } from "@/lib/autopilot/orchestrator";

interface AutopilotRunRequest {
  mode?: "full" | "fast";
  force?: boolean;
}

/**
 * POST /api/deals/[dealId]/autopilot/run
 *
 * Starts the real S1-S9 "Make E-Tran Ready" pipeline (agent swarm ->
 * claims -> arbitration -> truth snapshot -> package bundle). Previously
 * this route wrote 4 hardcoded fake `ai_events` rows and claimed
 * `etran_ready: true` without doing any real work — replaced with a real
 * call to startAutopilotRun(), which returns immediately with a runId;
 * poll GET /api/deals/[dealId]/autopilot/status?runId=... for progress.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as AutopilotRunRequest;

  const result = await startAutopilotRun(dealId, access.bankId, {
    mode: body.mode,
    force: body.force,
    triggeredBy: "banker",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
  }

  return NextResponse.json({ ok: true, runId: result.runId });
}
