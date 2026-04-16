import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

type RecoveryAction = {
  label: string;
  actionApi: string | null;
  actionMethod: "POST" | null;
  priority: "critical" | "high" | "medium";
};

/**
 * GET /api/deals/[dealId]/research/flight-deck
 *
 * Phase 81: Human review flight deck — shows bankers exactly what to fix
 * when a memo is blocked from committee status.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    // Parallel data loads
    const [trustGrade, missionRes, borrowerRes, qualityGateRes] = await Promise.all([
      loadTrustGradeForDeal(dealId),
      (sb as any)
        .from("buddy_research_missions")
        .select("id, status, completed_at")
        .eq("deal_id", dealId)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      (sb as any)
        .from("deals")
        .select("borrower_id")
        .eq("id", dealId)
        .maybeSingle()
        .then(async (dealRes: any) => {
          if (!dealRes.data?.borrower_id) return { data: null };
          return (sb as any)
            .from("borrowers")
            .select("legal_name, naics_code, naics_description, city, state")
            .eq("id", dealRes.data.borrower_id)
            .maybeSingle();
        }),
      (sb as any)
        .from("buddy_research_quality_gates")
        .select("trust_grade, quality_score, gate_failures, threads_failed, source_count, contradictions_found")
        .eq("deal_id", dealId)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const mission = missionRes?.data;
    const borrower = borrowerRes?.data;
    const gate = qualityGateRes?.data;

    // Compute blockers and recovery actions
    const blockers: string[] = [];
    const actions: RecoveryAction[] = [];

    // Subject lock checks
    const hasName = (borrower?.legal_name ?? "").trim().length >= 3;
    const hasNaics = (borrower?.naics_code ?? "") !== "" && borrower?.naics_code !== "999999";
    const hasGeo = (borrower?.city ?? "").trim().length > 0 || (borrower?.state ?? "").trim().length > 0;

    if (!hasName) {
      blockers.push("Borrower legal name missing");
      actions.push({ label: "Complete Intake", actionApi: null, actionMethod: null, priority: "critical" });
    }
    if (!hasNaics) {
      blockers.push("Industry classification missing or placeholder (999999)");
      actions.push({ label: "Set NAICS Code", actionApi: null, actionMethod: null, priority: "critical" });
    }
    if (!hasGeo) {
      blockers.push("Geography (city/state) missing");
    }

    // Research status
    if (!mission) {
      blockers.push("Research not yet run");
      actions.push({ label: "Run Research", actionApi: `/api/deals/${dealId}/research/run`, actionMethod: "POST", priority: "critical" });
    } else if (mission.status === "failed" || mission.status === "error") {
      blockers.push("Research mission failed");
      actions.push({ label: "Re-run Research", actionApi: `/api/deals/${dealId}/research/run`, actionMethod: "POST", priority: "critical" });
    }

    // Trust grade
    if (trustGrade && trustGrade !== "committee_grade") {
      blockers.push(`Research trust grade: ${trustGrade}`);
      if (trustGrade === "research_failed") {
        actions.push({ label: "Re-run Research", actionApi: `/api/deals/${dealId}/research/run`, actionMethod: "POST", priority: "critical" });
      }
    }

    // Gate failures
    if (Array.isArray(gate?.gate_failures)) {
      for (const f of gate.gate_failures as any[]) {
        const reason = typeof f === "string" ? f : f?.reason ?? f?.gate_id;
        if (reason && !blockers.includes(reason)) {
          blockers.push(reason);
        }
      }
    }

    // Contradiction gaps
    if ((gate?.contradictions_found ?? 0) === 0 && mission?.status === "complete") {
      blockers.push("No contradictions analyzed — adversarial review incomplete");
    }

    // Always offer memo rebuild
    actions.push({ label: "Rebuild Memo", actionApi: `/api/deals/${dealId}/credit-memo/generate`, actionMethod: "POST", priority: "medium" });

    return NextResponse.json({
      ok: true,
      trustGrade,
      isCommitteeEligible: trustGrade === "committee_grade" && blockers.length === 0,
      qualityScore: gate?.quality_score ?? null,
      subjectLocked: hasName && hasNaics,
      blockers,
      actions,
      borrower: {
        legal_name: borrower?.legal_name ?? null,
        naics_code: borrower?.naics_code ?? null,
        city: borrower?.city ?? null,
        state: borrower?.state ?? null,
      },
      research: {
        status: mission?.status ?? null,
        completed_at: mission?.completed_at ?? null,
        threads_failed: gate?.threads_failed ?? null,
        source_count: gate?.source_count ?? null,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
