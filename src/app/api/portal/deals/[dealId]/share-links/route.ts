// src/app/api/portal/deals/[dealId]/share-links/route.ts
import { NextResponse } from "next/server";
import { bearerToken, requireInviteForDeal } from "@/lib/portal/auth";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { BUSINESS_SHARE_CODES } from "@/lib/borrower/journey/collaboration";
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
    await authorize(req, dealId);
    const body = await req.json();
    const checklistItemIds = Array.isArray(body?.checklistItemIds)
      ? body.checklistItemIds.map(String)
      : [];
    if (!checklistItemIds.length) throw new Error("Missing checklistItemIds.");

    // Validate all requested items against this deal before creating any access.
    const { data: items, error: itemError } = await supabaseAdmin()
      .from("deal_portal_checklist_items")
      .select("id, code")
      .eq("deal_id", dealId)
      .in("id", checklistItemIds);
    if (
      itemError ||
      !items ||
      items.length !== checklistItemIds.length ||
      checklistItemIds.some(
        (id: string) => !items.some((item: any) => item.id === id),
      )
    )
      throw new Error("Invalid document selection.");
    if (
      body.purpose === "business_financials" &&
      (body.confirmed !== true ||
        items.some((item: any) => !BUSINESS_SHARE_CODES.includes(item.code)))
    )
      throw new Error("Choose business documents and confirm sharing.");

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
      id: link.id,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}

async function authorize(req: Request, dealId: string) {
  const session = await getBorrowerSession().catch(() => null);
  if (session?.deal_id === dealId) return;
  await requireInviteForDeal(
    bearerToken(
      req.headers.get("x-invite") ?? req.headers.get("authorization"),
    ),
    dealId,
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  try {
    await authorize(req, dealId);
  } catch {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const sb = supabaseAdmin();
  const [items, links] = await Promise.all([
    sb
      .from("deal_portal_checklist_items")
      .select("id, title, code")
      .eq("deal_id", dealId)
      .in("code", [...BUSINESS_SHARE_CODES]),
    sb
      .from("deal_portal_share_links")
      .select("id, recipient_name, checklist_item_ids, expires_at, revoked")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (items.error || links.error)
    return NextResponse.json(
      { ok: false, error: "Could not load document requests." },
      { status: 503 },
    );
  return NextResponse.json(
    { ok: true, items: items.data ?? [], links: links.data ?? [] },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  try {
    await authorize(req, dealId);
  } catch {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string")
    return NextResponse.json({ ok: false }, { status: 400 });
  const { data, error } = await supabaseAdmin()
    .from("deal_portal_share_links")
    .update({ revoked: true })
    .eq("id", body.id)
    .eq("deal_id", dealId)
    .select("id")
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { ok: false, error: "Could not revoke the link." },
      { status: 503 },
    );
  if (!data) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true });
}
