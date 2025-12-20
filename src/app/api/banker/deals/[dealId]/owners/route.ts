// src/app/api/banker/deals/[dealId]/owners/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureOwnerChecklist, createOrRefreshOwnerPortal, recomputeOwnerRequirements } from "@/lib/ownership/server";
import { inferOwnershipFromDocs } from "@/lib/ownership/infer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    requireUserId(req);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;

    const { data: owners, error } = await sb
      .from("deal_owners")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const inferred = await inferOwnershipFromDocs(dealId);

    return NextResponse.json({ ok: true, owners: owners ?? [], inferred });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    requireUserId(req);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;

    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "set_owner") {
      const ownerId = String(body?.ownerId ?? "");
      const ownershipPercent = body?.ownershipPercent === null ? null : Number(body?.ownershipPercent);
      const email = body?.email ? String(body.email) : null;
      const fullName = body?.fullName ? String(body.fullName) : null;

      if (!ownerId) throw new Error("Missing ownerId.");

      const { error } = await sb
        .from("deal_owners")
        .update({
          ownership_percent: ownershipPercent,
          ownership_source: "banker_entered",
          ownership_confidence: null,
          email,
          ...(fullName ? { full_name: fullName } : {}),
        })
        .eq("id", ownerId);

      if (error) throw error;

      await recomputeOwnerRequirements(dealId);

      return NextResponse.json({ ok: true });
    }

    if (action === "create_owner_portal") {
      const ownerId = String(body?.ownerId ?? "");
      if (!ownerId) throw new Error("Missing ownerId.");

      // Ensure checklist for this owner (idempotent)
      await ensureOwnerChecklist(ownerId, dealId);

      const portal = await createOrRefreshOwnerPortal({ dealId, ownerId });

      // Return relative URL (caller can convert to absolute)
      return NextResponse.json({ ok: true, ownerPortalUrl: `/portal/owner/${portal.token}`, expiresAt: portal.expires_at });
    }

    throw new Error("Unknown action.");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
