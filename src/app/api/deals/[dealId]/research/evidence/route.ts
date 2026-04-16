import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  loadEvidenceForMemoSection,
  loadAllEvidenceForDeal,
} from "@/lib/research/memoEvidenceResolver";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
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

    return NextResponse.json({
      ok: true,
      evidence: grouped,
      section_count: allEvidence.size,
      total_claims: [...allEvidence.values()].reduce((sum, rows) => sum + rows.length, 0),
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
