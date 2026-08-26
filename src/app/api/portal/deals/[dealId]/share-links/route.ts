// src/app/api/portal/deals/[dealId]/share-links/route.ts
import { NextResponse } from "next/server";
import { bearerToken, requireInviteForDeal } from "@/lib/portal/auth";
import { createShareLink } from "@/lib/portal/shareLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    // The invite must be for THIS deal — a share link grants a third party
    // read access to the named deal's checklist items for 7 days, so an
    // unbound invite here would let any borrower mint access to any deal.
    await requireInviteForDeal(
      bearerToken(req.headers.get("x-invite")),
      dealId,
    );
    const body = await req.json();
    const checklistItemIds = Array.isArray(body?.checklistItemIds)
      ? body.checklistItemIds.map(String)
      : [];
    if (!checklistItemIds.length) throw new Error("Missing checklistItemIds.");

    const recipientName = body?.recipientName
      ? String(body.recipientName)
      : null;
    const note = body?.note ? String(body.note) : null;

    const link = await createShareLink({
      dealId,
      createdBy: "borrower", // keep simple; optional
      checklistItemIds,
      recipientName,
      note,
      expiresHours: 168, // 7 days
    });

    // IMPORTANT: return relative URL so env handles domain
    const shareUrl = `/portal/share/${link.token}`;

    return NextResponse.json({
      ok: true,
      shareUrl,
      expiresAt: link.expires_at,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
