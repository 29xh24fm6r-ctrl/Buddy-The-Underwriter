import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { backfillCanonicalFactsFromSpreads } from "@/lib/financialFacts/backfillFromSpreads";
import { extractFactsFromDocument } from "@/lib/financialSpreads/extractFactsFromDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const documentId = typeof body?.documentId === "string" ? body.documentId : null;
    const includeDocs = Boolean(body?.includeDocs);

    const spreadBackfill = await backfillCanonicalFactsFromSpreads({ dealId, bankId: access.bankId });
    if (!spreadBackfill.ok) {
      return NextResponse.json({ ok: false, error: spreadBackfill.error }, { status: 500 });
    }

    let docFactsWritten = 0;
    if (includeDocs && documentId) {
      const res = await extractFactsFromDocument({ dealId, bankId: access.bankId, documentId });
      docFactsWritten = res.factsWritten;
    }

    return NextResponse.json({
      ok: true,
      dealId,
      bankId: access.bankId,
      spreads: spreadBackfill,
      docs: includeDocs && documentId ? { ok: true, documentId, factsWritten: docFactsWritten } : { ok: false },
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/facts/backfill]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
