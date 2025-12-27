import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/ai-events";
import { arbitrateClaims } from "@/lib/arbitration";
import { applyBankOverlay } from "@/lib/bank-overlays";

export async function POST(
  _req: Request,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;

  await writeAiEvent({
    deal_id: dealId,
    kind: "preapproval.run.started",
    scope: "dual",
    action: "simulate"
  });

  // Simulated agent findings
  const agentFindings = [
    { claim: "global_dscr", value: 1.18, confidence: 0.7 },
    { claim: "global_dscr", value: 1.12, confidence: 0.5 }
  ];

  const arbitration = arbitrateClaims(agentFindings);

  await writeAiEvent({
    deal_id: dealId,
    kind: "arbitration.decision",
    scope: "cashflow",
    action: "resolve",
    output_json: arbitration,
    confidence: arbitration.chosen.confidence
  });

  const overlay = applyBankOverlay("LOCAL_SBA", {
    global_dscr: arbitration.chosen.value,
    irs_transcript: false
  });

  const result = {
    status: overlay.blocked ? "conditional" : "pass",
    reason: overlay.reason ?? null,
    dscr: arbitration.chosen.value
  };

  await writeAiEvent({
    deal_id: dealId,
    kind: "preapproval.result",
    scope: "dual",
    action: "evaluate",
    output_json: result,
    confidence: 0.76
  });

  return NextResponse.json({ ok: true });
}
