import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 15;

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

    const [
      spreadsRes,
      snapshotRes,
      riskRunRes,
      memoRes,
      researchRes,
      packetEventRes,
      decisionSnapshotRes,
      qualityGateRes,
      completenessFactsRes,
    ] = await Promise.all([
      // 1. Actual deal_spreads rows — use real data, not workspace status field.
      //    Count populated rows (rows with at least one non-null value) to determine completion.
      sb.from("deal_spreads")
        .select("spread_type, status, updated_at")
        .eq("deal_id", dealId)
        .eq("status", "ready")
        .neq("spread_type", "T12"),

      // 2. Financial snapshot — financial_snapshots (not financial_snapshots_v2)
      sb.from("financial_snapshots")
        .select("id, created_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 3. AI risk run — ai_risk_runs.status does NOT exist; row presence = complete
      sb.from("ai_risk_runs")
        .select("id, grade, created_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 4. Credit memo
      sb.from("canonical_memo_narratives")
        .select("id, generated_at, input_hash")
        .eq("deal_id", dealId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 5. Research
      sb.from("buddy_research_missions")
        .select("id, status, created_at, completed_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 6a. Committee packet event
      sb.from("deal_events")
        .select("created_at")
        .eq("deal_id", dealId)
        .eq("kind", "deal.committee.packet.generated")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 6b. Decision snapshot — required by packet generate route
      sb.from("decision_snapshots")
        .select("id, created_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 7. Phase 78/79: Research quality gate — expanded for trust clarity
      sb.from("buddy_research_quality_gates")
        .select("trust_grade, quality_score, gate_failures, threads_failed, threads_succeeded, source_count, contradictions_found")
        .eq("deal_id", dealId)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 8. Phase 79: Spread completeness — presence of critical fact keys
      sb.from("deal_financial_facts")
        .select("fact_key")
        .eq("deal_id", dealId)
        .eq("is_superseded", false)
        .neq("resolution_status", "rejected")
        .not("fact_value_num", "is", null)
        .in("fact_key", [
          "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME",
          "NET_INCOME", "ORDINARY_BUSINESS_INCOME",
          "DEPRECIATION", "INTEREST_EXPENSE", "COST_OF_GOODS_SOLD",
          "SL_TOTAL_ASSETS", "SL_CASH", "SL_AR_GROSS",
          "ADS", "ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_PROPOSED",
          "DSCR", "GCF_DSCR",
          "EBITDA",
          "NET_WORTH", "SL_TOTAL_EQUITY", "SL_RETAINED_EARNINGS",
        ]),
    ]);

    const readySpreads = spreadsRes.data ?? [];
    const snapshot = snapshotRes.data;
    const riskRun = riskRunRes.data;
    const memo = memoRes.data;
    const research = researchRes.data;
    const packetEvent = packetEventRes.data;
    const decisionSnapshot = decisionSnapshotRes.data;
    const qualityGate = qualityGateRes.data as {
      trust_grade: string;
      quality_score: number;
      gate_failures: any[] | null;
      threads_failed: number | null;
      threads_succeeded: number | null;
      source_count: number | null;
      contradictions_found: number | null;
    } | null;

    // Compute spread completeness from returned fact keys
    const CRITICAL_PRIMARY = [
      "GROSS_RECEIPTS", "NET_INCOME", "DEPRECIATION",
      "INTEREST_EXPENSE", "COST_OF_GOODS_SOLD",
      "SL_TOTAL_ASSETS", "SL_CASH", "SL_AR_GROSS",
      "ADS", "DSCR", "EBITDA", "NET_WORTH",
    ] as const;
    const CRITICAL_FALLBACKS: Record<string, string[]> = {
      GROSS_RECEIPTS: ["TOTAL_REVENUE", "TOTAL_INCOME"],
      NET_INCOME:     ["ORDINARY_BUSINESS_INCOME"],
      ADS:            ["ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_PROPOSED"],
      DSCR:           ["GCF_DSCR"],
      NET_WORTH:      ["SL_TOTAL_EQUITY", "SL_RETAINED_EARNINGS"],
    };
    const presentFactKeys = new Set(
      (completenessFactsRes.data ?? []).map((f: { fact_key: string }) => f.fact_key),
    );
    let spreadCompletenessScore: number | null = null;
    {
      let populated = 0;
      for (const key of CRITICAL_PRIMARY) {
        const toCheck = [key, ...(CRITICAL_FALLBACKS[key] ?? [])];
        if (toCheck.some((k) => presentFactKeys.has(k))) populated++;
      }
      spreadCompletenessScore = Math.round((populated / CRITICAL_PRIMARY.length) * 100);
    }

    const steps: PipelineStep[] = [
      buildSpreadStep(dealId, readySpreads, spreadCompletenessScore),
      buildSnapshotStep(snapshot),
      buildRiskStep(dealId, riskRun),
      buildMemoStep(dealId, memo, snapshot),
      buildResearchStep(dealId, research, qualityGate),
      buildPacketStep(dealId, packetEvent, memo, decisionSnapshot, qualityGate),
    ];

    return NextResponse.json({ ok: true, steps });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 },
    );
  }
}

function buildSpreadStep(
  dealId: string,
  readySpreads: Array<{ spread_type: string; status: string; updated_at: string | null }>,
  completenessScore: number | null,
): PipelineStep {
  const count = readySpreads.length;
  const latestAt = readySpreads
    .map(s => s.updated_at)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] ?? null;

  let status: PipelineStepStatus;
  let detail: string | null;

  if (count > 0) {
    status = "complete";
    if (completenessScore !== null) {
      const pct = Math.round(completenessScore);
      detail = `${count} spread${count !== 1 ? "s" : ""} ready \u00b7 ${pct}% complete${pct >= 80 ? " \u2713" : ""}`;
    } else {
      detail = `${count} spread${count !== 1 ? "s" : ""} ready`;
    }
  } else {
    status = "pending";
    detail = "Financial spreads not yet generated";
  }

  return {
    stepNumber: 1,
    key: "spreads",
    label: "Financial Spreads",
    status,
    detail,
    blockerMessage: null,
    // Wire the real recompute endpoint — this actually regenerates spreads from facts
    actionApi: `/api/deals/${dealId}/spreads/recompute`,
    actionLabel: count > 0 ? "Recompute Spreads" : "Generate Spreads",
    actionMethod: "POST",
    completedAt: latestAt,
  };
}

function buildSnapshotStep(
  snapshot: { id: string; created_at: string } | null,
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
  riskRun: { id: string; grade: string; created_at: string } | null,
): PipelineStep {
  return {
    stepNumber: 3,
    key: "risk",
    label: "AI Risk Assessment",
    status: riskRun ? "complete" : "pending",
    detail: riskRun
      ? (riskRun.grade ? `Grade: ${riskRun.grade}` : "Risk assessment complete")
      : "AI risk assessment not yet run",
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
  qualityGate: {
    trust_grade: string;
    quality_score: number;
    gate_failures: any[] | null;
    threads_failed: number | null;
    threads_succeeded: number | null;
    source_count: number | null;
    contradictions_found: number | null;
  } | null = null,
): PipelineStep {
  let status: PipelineStepStatus;
  let detail: string | null = null;
  let blockerMessage: string | null = null;

  if (research) {
    const s = research.status ?? "completed";
    if (s === "failed" || s === "error") {
      status = "error";
      detail = "Research mission failed — retry available";
    } else if (s === "running" || s === "queued" || s === "pending") {
      status = "in_progress";
      detail = "Research mission in progress…";
    } else {
      // Phase 79: Map trust grade to pipeline status with degraded reasons
      if (qualityGate) {
        const grade = qualityGate.trust_grade;
        const gradeLabel = grade === "committee_grade" ? "Committee-grade ✓"
          : grade === "preliminary" ? "Preliminary"
          : grade === "manual_review_required" ? "Manual review required"
          : "Research failed";
        detail = `${gradeLabel} · Quality: ${qualityGate.quality_score}/100`;

        if (grade === "research_failed") {
          status = "error";
          blockerMessage = buildDegradedReasons(qualityGate);
        } else if (grade === "manual_review_required") {
          status = "blocked";
          blockerMessage = buildDegradedReasons(qualityGate);
        } else if (grade === "preliminary") {
          status = "complete";
          // Append degraded reasons to detail for visibility
          const reasons = buildDegradedReasons(qualityGate);
          if (reasons) detail += ` — ${reasons}`;
        } else {
          status = "complete";
        }
      } else {
        status = "complete";
        detail = "Research complete";
      }
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
    blockerMessage,
    actionApi: `/api/deals/${dealId}/research/run`,
    actionLabel: research ? "Re-run Research" : "Run Research",
    actionMethod: "POST",
    completedAt: research?.completed_at ?? null,
  };
}

/** Phase 79: Build human-readable degraded reasons from quality gate data. */
function buildDegradedReasons(gate: {
  trust_grade: string;
  threads_failed: number | null;
  threads_succeeded: number | null;
  source_count: number | null;
  contradictions_found: number | null;
  gate_failures: any[] | null;
}): string | null {
  const reasons: string[] = [];

  if ((gate.threads_failed ?? 0) > 0) {
    reasons.push(`${gate.threads_failed} thread(s) failed`);
  }
  if ((gate.threads_succeeded ?? 0) < 4) {
    reasons.push(`only ${gate.threads_succeeded ?? 0}/6 threads completed`);
  }
  if ((gate.source_count ?? 0) < 5) {
    reasons.push(`weak source coverage (${gate.source_count ?? 0} sources)`);
  }

  // Parse gate_failures JSONB for specific failure reasons
  if (Array.isArray(gate.gate_failures)) {
    for (const f of gate.gate_failures) {
      const reason = typeof f === "string" ? f : (f as any)?.reason ?? (f as any)?.gate_id;
      if (reason && !reasons.some((r) => r.includes(reason))) {
        reasons.push(reason);
      }
    }
  }

  return reasons.length > 0 ? reasons.join("; ") : null;
}

function buildPacketStep(
  dealId: string,
  packetEvent: { created_at: string } | null,
  memo: { id: string } | null,
  decisionSnapshot: { id: string; created_at: string } | null,
  qualityGate: { trust_grade: string; quality_score: number } | null = null,
): PipelineStep {
  let status: PipelineStepStatus;
  let detail: string | null = null;
  let blockerMessage: string | null = null;

  // Phase 79: Block committee packet when research isn't committee-grade
  const trustGrade = qualityGate?.trust_grade ?? null;
  const researchBlocksPacket =
    trustGrade !== null && trustGrade !== "committee_grade";

  if (packetEvent) {
    status = "complete";
    detail = "Committee packet generated";
  } else if (!memo) {
    status = "blocked";
    detail = "Waiting for credit memo";
    blockerMessage = "Generate the credit memo before creating the committee packet";
  } else if (!decisionSnapshot) {
    status = "blocked";
    detail = "Credit decision required";
    blockerMessage = "Record a credit decision on the Committee tab to unlock packet generation";
  } else if (researchBlocksPacket) {
    status = "blocked";
    detail = `Research grade: ${trustGrade} — committee-grade required`;
    blockerMessage = `Committee packet requires committee-grade research. Current grade: ${trustGrade}. Re-run or improve research quality.`;
  } else {
    status = "pending";
    detail = "Committee packet not yet generated";
  }

  const canAct = memo && decisionSnapshot && !researchBlocksPacket;

  return {
    stepNumber: 6,
    key: "packet",
    label: "Committee Packet",
    status,
    detail,
    blockerMessage,
    actionApi: canAct ? `/api/deals/${dealId}/committee/packet/generate` : null,
    actionLabel: packetEvent ? "Regenerate Packet" : (canAct ? "Generate Committee Packet" : null),
    actionMethod: canAct ? "POST" : null,
    completedAt: (packetEvent as any)?.created_at ?? null,
  };
}
