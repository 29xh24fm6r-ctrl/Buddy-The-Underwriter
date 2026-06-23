import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  loadEvidenceForMemoSection,
  loadAllEvidenceForDeal,
} from "@/lib/research/memoEvidenceResolver";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/research/evidence?section=industry_overview
 *
 * Phase 81: Evidence drillthrough API — lets bankers drill from memo
 * sections into the underlying claims, sources, and thread origins.
 *
 * Without ?section param, returns all evidence grouped by section.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const section = req.nextUrl.searchParams.get("section");

    if (section) {
      const evidence = await loadEvidenceForMemoSection(dealId, section);
      return NextResponse.json({
        ok: true,
        section,
        evidence,
        count: evidence.length,
      });
    }

    // Return all evidence grouped by section
    const allEvidence = await loadAllEvidenceForDeal(dealId);
    const grouped: Record<string, any[]> = {};
    for (const [sectionKey, rows] of allEvidence.entries()) {
      grouped[sectionKey] = rows;
    }

    // Phase 82: per-section inference ratio for the memo UI.
    // evidence_type === "inference" comes from buddy_research_evidence, which is
    // surfaced as `layer` on MemoEvidenceRow by the resolver.
    const sectionStats = Object.entries(grouped).map(([section, rows]) => {
      const total = (rows as any[]).length;
      const inferences = (rows as any[]).filter(
        (r: any) => r?.layer === "inference" || r?.evidence_type === "inference",
      ).length;
      const inferenceRatio = total > 0 ? inferences / total : 0;
      return {
        section,
        total,
        inferences,
        inferenceRatio,
        isInferenceDominated: total > 0 && inferenceRatio > 0.6,
      };
    });

    return NextResponse.json({
      ok: true,
      evidence: grouped,
      section_count: allEvidence.size,
      total_claims: [...allEvidence.values()].reduce((sum, rows) => sum + rows.length, 0),
      sectionStats,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
