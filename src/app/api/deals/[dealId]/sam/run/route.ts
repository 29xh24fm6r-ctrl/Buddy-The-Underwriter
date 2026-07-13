import "server-only";

/** SPEC S4 C-3 — POST /api/deals/[dealId]/sam/run */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { runSamCheck } from "@/lib/integrations/samGov/service";
import { fetchSamExclusions } from "@/lib/integrations/samGov/client";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId } = await assertDealAccess(rawDealId);

    const body = await req.json().catch(() => null);
    const ownershipEntityId: string | undefined = body?.ownership_entity_id;
    const borrowerId: string | undefined = body?.borrower_id;
    if (!ownershipEntityId && !borrowerId) {
      return NextResponse.json({ ok: false, error: "missing_ownership_entity_id_or_borrower_id" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    let name: string | null = null;
    let ein: string | null = null;
    if (ownershipEntityId) {
      const { data: owner } = await sb.from("ownership_entities").select("display_name").eq("id", ownershipEntityId).eq("deal_id", dealId).maybeSingle();
      if (!owner) return NextResponse.json({ ok: false, error: "owner_not_found" }, { status: 404 });
      name = owner.display_name;
    } else if (borrowerId) {
      const { data: borrower } = await sb.from("borrowers").select("legal_name, ein").eq("id", borrowerId).maybeSingle();
      if (!borrower) return NextResponse.json({ ok: false, error: "borrower_not_found" }, { status: 404 });
      name = borrower.legal_name;
      ein = borrower.ein;
    }

    if (!name) {
      return NextResponse.json({ ok: false, error: "subject_missing_name" }, { status: 422 });
    }

    const result = await runSamCheck(
      { dealId, bankId, ownershipEntityId: ownershipEntityId ?? null, borrowerId: borrowerId ?? null, name, ein },
      { sb, vendor: { fetchSamExclusions } },
    );

    if (!result.ok) {
      const status = result.reason === "MISSING_SUBJECT" ? 400 : 502;
      return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
    }

    return NextResponse.json({ ok: true, check_id: result.checkId, status: result.status, hit_count: result.hitCount, reused: result.reused });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/sam/run]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
