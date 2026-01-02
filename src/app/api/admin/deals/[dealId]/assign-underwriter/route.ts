import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import {
  registerUnderwriterParticipant,
  getDealParticipants,
} from "@/lib/deals/participants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/deals/[dealId]/assign-underwriter
 *
 * Assign an underwriter to a deal via deal_participants table.
 * Super-admin only. Logs audit event.
 *
 * Body: { clerk_user_id: string }
 * Returns: { ok: true, participants: Participant[] }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  requireSuperAdmin();
  const { dealId } = await ctx.params;
  const { userId: actor } = await clerkAuth();

  const body = await req.json().catch(() => ({}));
  const clerk_user_id = String(body?.clerk_user_id ?? "");

  if (!clerk_user_id) {
    return NextResponse.json(
      { ok: false, error: "clerk_user_id required" },
      { status: 400 },
    );
  }

  try {
    // Register underwriter as participant (with audit)
    await registerUnderwriterParticipant(
      dealId,
      clerk_user_id,
      actor ?? undefined,
    );

    // Return all participants for this deal
    const participants = await getDealParticipants(dealId);

    return NextResponse.json({ ok: true, participants });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? String(error) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/admin/deals/[dealId]/assign-underwriter
 *
 * Get all participants for a deal
 * Super-admin only.
 *
 * Returns: { ok: true, participants: Participant[] }
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  requireSuperAdmin();
  const { dealId } = await ctx.params;
  try {
    const participants = await getDealParticipants(dealId);
    return NextResponse.json({ ok: true, participants });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? String(error) },
      { status: 500 },
    );
  }
}
