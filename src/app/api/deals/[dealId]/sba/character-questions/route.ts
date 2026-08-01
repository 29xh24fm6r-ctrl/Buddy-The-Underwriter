import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  confirmCharacterAnswersBulk,
  getCharacterConfirmationStatus,
} from "@/lib/sba/forms/characterQuestionConfirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/sba/character-questions?ownershipEntityId=...
 *
 * Returns character question confirmation status for one owner.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const ownershipEntityId = req.nextUrl.searchParams.get("ownershipEntityId");
  if (!ownershipEntityId) {
    return NextResponse.json({ ok: false, error: "ownershipEntityId required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const statuses = await getCharacterConfirmationStatus(sb, { dealId, ownershipEntityId });
  return NextResponse.json({ ok: true, questions: statuses });
}

/**
 * POST /api/deals/[dealId]/sba/character-questions
 *
 * Bulk-confirm character question answers for one owner. Each answer
 * is written to BOTH the canonical ownership_entities column AND the
 * character_question_confirmations table atomically.
 *
 * Body: { ownershipEntityId: string, answers: Record<string, boolean> }
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.ownershipEntityId || !body.answers || typeof body.answers !== "object") {
    return NextResponse.json(
      { ok: false, error: "ownershipEntityId and answers (Record<string, boolean>) required" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const result = await confirmCharacterAnswersBulk(sb, {
    dealId,
    ownershipEntityId: body.ownershipEntityId,
    answers: body.answers,
    confirmedBy: auth.userId,
    ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
