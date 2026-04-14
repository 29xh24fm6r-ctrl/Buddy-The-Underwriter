import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 15;

// ── Types ──────────────────────────────────────────────────────────────────

export type PipelineStepStatus =
  | "complete"
  | "in_progress"
  | "pending"
  | "blocked"
  | "error";

export type PipelineStep = {
  stepNumber: number;
  key: string;
  label: string;
  status: PipelineStepStatus;
  detail: string | null;
  blockerMessage: string | null;
  actionApi: string | null;
  actionLabel: string | null;
  actionMethod: "POST" | null;
  completedAt: string | null;
};

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/underwrite/pipeline-state
 *
 * Returns the ordered pipeline steps for the underwriting rail.
 * Each step queries its canonical source table and derives status.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    // ── Parallel queries ─────────────────────────────────────────────────
    const [
      workspaceRes,
      snapshotRes,
      riskRunRes,
      memoRes,
      researchRes,
      packetEventRes,
    ] = await Promise.all([
      // 1. Workspace — spread status
      sb.from("underwriting_workspaces")
        .select("spread_status, memo_status, risk_status")
        .eq("deal_id", dealId)
        .maybeSingle(),

      // 2. Financial snapshot
      sb.from("financial_snapshots_v2")
        .select("id, created_at, is_active")
        .eq("deal_id", dealId)
        .eq("is_active", true)
        .maybeSingle(),

      // 3. AI risk run — latest
      sb.from("ai_risk_runs")
        .select("id, grade, created_at, status")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 4. Credit memo — latest canonical narrative
      sb.from("canonical_memo_narratives")
        .select("id, generated_at, input_hash")
        .eq("deal_id", dealId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 5. Research — latest mission
      sb.from("buddy_research_missions")
        .select("id, status, created_at, completed_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 6. Committee packet — latest generation event
      sb.from("deal_events")
        .select("created_at")
        .eq("deal_id", dealId)
        .eq("kind", "deal.committee.packet.generated")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const workspace = workspaceRes.data;
    const snapshot = snapshotRes.data;
    const riskRun = riskRunRes.data;
    const memo = memoRes.data;
    const research = researchRes.data;
    const packetEvent = packetEventRes.data;

    // ── Build steps ──────────────────────────────────────────────────────

    const steps: PipelineStep[] = [
      buildSpreadStep(dealId, workspace),
      buildSnapshotStep(snapshot),
      buildRiskStep(dealId, riskRun),
      buildMemoStep(dealId, memo, snapshot),
      buildResearchStep(dealId, research),
      buildPacketStep(dealId, packetEvent, memo),
    ];

    return NextResponse.json({ ok: true, steps });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 },
    );
  }
}

// ── Step builders ────────────────────────────────────────────────────────

function buildSpreadStep(
  dealId: string,
  workspace: { spread_status: string; memo_status: string; risk_status: string } | null,
): PipelineStep {
  const spreadStatus = workspace?.spread_status ?? "not_started";

  let status: PipelineStepStatus;
  let detail: string | null = null;

  switch (spreadStatus) {
    case "complete":
    case "completed":
      status = "complete";
      detail = "Spreads completed";
      break;
    case "in_progress":
      status = "in_progress";
      detail = "Spreads in progress";
      break;
    default:
      status = "pending";
      detail = "Financial spreads not started";
  }

  return {
    stepNumber: 1,
    key: "spreads",
    label: "Financial Spreads",
    status,
    detail,
    blockerMessage: null,
    actionApi: null,
    actionLabel: null,
    actionMethod: null,
    completedAt: null,
  };
}

function buildSnapshotStep(
  snapshot: { id: string; created_at: string; is_active: boolean } | null,
): PipelineStep {
  const hasSnapshot = !!snapshot;

  return {
    stepNumber: 2,
    key: "snapshot",
    label: "Financial Snapshot",
    status: hasSnapshot ? "complete" : "pending",
    detail: hasSnapshot ? "Active snapshot available" : "No active snapshot yet",
    blockerMessage: !hasSnapshot ? "Complete spreads to generate a financial snapshot" : null,
    actionApi: null,
    actionLabel: null,
    actionMethod: null,
    completedAt: snapshot?.created_at ?? null,
  };
}

function buildRiskStep(
  dealId: string,
  riskRun: { id: string; grade: string; created_at: string; status: string } | null,
): PipelineStep {
  let status: PipelineStepStatus;
  let detail: string | null = null;

  if (riskRun) {
    const runStatus = riskRun.status ?? "completed";
    if (runStatus === "failed" || runStatus === "error") {
      status = "error";
      detail = "Risk assessment failed — retry available";
    } else if (runStatus === "running" || runStatus === "pending") {
      status = "in_progress";
      detail = "Risk assessment running…";
    } else {
      status = "complete";
      detail = riskRun.grade ? `Grade: ${riskRun.grade}` : "Risk assessment complete";
    }
  } else {
    status = "pending";
    detail = "AI risk assessment not yet run";
  }

  return {
    stepNumber: 3,
    key: "risk",
    label: "AI Risk Assessment",
    status,
    detail,
    blockerMessage: null,
    actionApi: `/api/deals/${dealId}/ai-risk`,
    actionLabel: riskRun ? "Re-run Risk Assessment" : "Run Risk Assessment",
    actionMethod: "POST",
    completedAt: riskRun?.created_at ?? null,
  };
}

function buildMemoStep(
  dealId: string,
  memo: { id: string; generated_at: string; input_hash: string } | null,
  snapshot: { id: string } | null,
): PipelineStep {
  let status: PipelineStepStatus;
  let detail: string | null = null;
  let blockerMessage: string | null = null;

  if (memo) {
    status = "complete";
    detail = "Credit memo generated";
  } else if (!snapshot) {
    status = "blocked";
    detail = "Waiting for financial snapshot";
    blockerMessage = "A financial snapshot is required before generating the credit memo";
  } else {
    status = "pending";
    detail = "Credit memo not yet generated";
  }

  return {
    stepNumber: 4,
    key: "memo",
    label: "Credit Memo",
    status,
    detail,
    blockerMessage,
    actionApi: `/api/deals/${dealId}/credit-memo/generate`,
    actionLabel: memo ? "Regenerate Memo" : "Generate Credit Memo",
    actionMethod: "POST",
    completedAt: memo?.generated_at ?? null,
  };
}

function buildResearchStep(
  dealId: string,
  research: { id: string; status: string; created_at: string; completed_at: string | null } | null,
): PipelineStep {
  let status: PipelineStepStatus;
  let detail: string | null = null;

  if (research) {
    const missionStatus = research.status ?? "completed";
    if (missionStatus === "failed" || missionStatus === "error") {
      status = "error";
      detail = "Research mission failed — retry available";
    } else if (missionStatus === "running" || missionStatus === "queued" || missionStatus === "pending") {
      status = "in_progress";
      detail = "Research mission in progress…";
    } else {
      status = "complete";
      detail = "Research complete";
    }
  } else {
    status = "pending";
    detail = "Buddy research not yet run";
  }

  return {
    stepNumber: 5,
    key: "research",
    label: "Buddy Research",
    status,
    detail,
    blockerMessage: null,
    actionApi: `/api/deals/${dealId}/research/run`,
    actionLabel: research ? "Re-run Research" : "Run Research",
    actionMethod: "POST",
    completedAt: research?.completed_at ?? null,
  };
}

function buildPacketStep(
  dealId: string,
  packetEvent: { created_at: string } | null,
  memo: { id: string } | null,
): PipelineStep {
  let status: PipelineStepStatus;
  let detail: string | null = null;
  let blockerMessage: string | null = null;

  if (packetEvent) {
    status = "complete";
    detail = "Committee packet generated";
  } else if (!memo) {
    status = "blocked";
    detail = "Waiting for credit memo";
    blockerMessage = "Generate the credit memo before creating the committee packet";
  } else {
    status = "pending";
    detail = "Committee packet not yet generated";
  }

  return {
    stepNumber: 6,
    key: "packet",
    label: "Committee Packet",
    status,
    detail,
    blockerMessage,
    actionApi: `/api/deals/${dealId}/committee/packet/generate`,
    actionLabel: packetEvent ? "Regenerate Packet" : "Generate Committee Packet",
    actionMethod: "POST",
    completedAt: (packetEvent as any)?.created_at ?? null,
  };
}
