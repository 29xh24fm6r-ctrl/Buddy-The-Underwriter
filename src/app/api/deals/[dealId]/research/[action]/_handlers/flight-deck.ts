import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { buildResearchSubject } from "@/lib/research/buildResearchSubject";
import { validateSubjectLock } from "@/lib/research/subjectLock";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
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

    // Parallel data loads.
    // SPEC-RESEARCH-SUBJECT-LOCK-MEMO-INPUT-PARITY-1: the subject lock is derived
    // from the canonical builder (memo-input parity) instead of a borrowers-only
    // read gated on the legacy borrower_id, so the flight deck agrees with
    // research/run and with lifecycle/underwrite.
    const [trustGrade, missionRes, subjectRes, qualityGateRes] = await Promise.all([
      loadTrustGradeForDeal(dealId),
      (sb as any)
        .from("buddy_research_missions")
        .select("id, status, completed_at")
        .eq("deal_id", dealId)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      buildResearchSubject(sb, dealId),
      (sb as any)
        .from("buddy_research_quality_gates")
        .select("trust_grade, quality_score, gate_failures, threads_failed, source_count, contradictions_found")
        .eq("deal_id", dealId)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const mission = missionRes?.data;
    const gate = qualityGateRes?.data;
    const { subject, naics_provisional } = subjectRes;

    // Compute blockers and recovery actions
    const blockers: string[] = [];
    const actions: RecoveryAction[] = [];

    // Subject lock — run the canonical validator over the built subject.
    const lock = validateSubjectLock({
      company_name: subject.company_name,
      naics_code: subject.naics_code,
      naics_description: subject.naics_description,
      business_description: subject.business_description,
      city: subject.city,
      state: subject.state,
      geography: subject.geography,
      website: subject.website,
      dba: subject.dba,
      banker_summary: subject.banker_summary,
      banker_override: subject.banker_override,
    });

    if (!lock.ok) {
      for (const reason of lock.reasons) {
        if (!blockers.includes(reason)) blockers.push(reason);
        if (reason.includes("legal name")) {
          actions.push({ label: "Complete Intake", actionApi: `/deals/${dealId}/memo-inputs`, actionMethod: null, priority: "critical" });
        }
      }
    }

    // NAICS: when there is no real NAICS *number*, surface a precise, actionable
    // advisory — NOT a hard "research cannot identify borrower" failure. The
    // wording depends on whether an industry description is already available:
    //   - description present → "NAICS code not set — industry description is
    //     available" (high-priority advisory; the subject lock still clears)
    //   - nothing at all      → "Set industry classification / NAICS"
    // Both deep-link to the memo-input Borrower Story section, where industry /
    // NAICS context is now editable (SPEC-MEMO-INPUTS-INDUSTRY-CLASSIFICATION-FIELD-1).
    if (naics_provisional) {
      const hasIndustryDesc = (subject.naics_description ?? "").trim().length > 0;
      const advisory = hasIndustryDesc
        ? "NAICS code not set — industry description is available"
        : "Set industry classification / NAICS";
      if (!blockers.includes(advisory)) blockers.push(advisory);
      actions.push({
        label: "Set industry classification / NAICS",
        actionApi: `/deals/${dealId}/memo-inputs#borrower-story`,
        actionMethod: null,
        priority: lock.ok ? "high" : "critical",
      });
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
      // Subject lock now reflects the canonical validator (memo-input parity).
      // A provisional NAICS is an advisory, not a lock failure.
      subjectLocked: lock.ok,
      naicsProvisional: naics_provisional,
      blockers,
      actions,
      borrower: {
        legal_name: subject.company_name ?? null,
        naics_code: subject.naics_code ?? null,
        naics_description: subject.naics_description ?? null,
        business_description: subject.business_description ?? null,
        city: subject.city ?? null,
        state: subject.state ?? null,
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
