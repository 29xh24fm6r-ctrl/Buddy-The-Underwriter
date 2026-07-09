import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDefaultPortalStatus, listChecklist } from "@/lib/portal/checklist";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/portal/[token]/checklist
 *
 * Borrower portal checklist (borrower-safe): missing vs received.
 * Auth via borrower_portal_links.token (no Clerk).
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const sb = supabaseAdmin();

    const { data: link, error: linkErr } = await sb
      .from("borrower_portal_links")
      .select("deal_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkErr) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    // Fall back to a borrower_invites token so the invite flow renders too.
    let dealId: string | null = link?.deal_id ?? null;
    if (!link) {
      try {
        dealId = (await resolveBorrowerToken(token)).deal_id;
      } catch {
        return NextResponse.json(
          { ok: false, error: "Invalid or expired link" },
          { status: 403 },
        );
      }
    } else if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: "Link expired" }, { status: 403 });
    }

    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    await ensureDefaultPortalStatus(dealId);

    const rows = await listChecklist(dealId);

    const required = (rows ?? []).filter((r: any) => !!r?.item?.required);
    const missing = required.filter((r: any) => (r?.state?.status ?? "missing") === "missing");
    const received = required.filter((r: any) => (r?.state?.status ?? "missing") !== "missing");

    return NextResponse.json({
      ok: true,
      dealId,
      stats: {
        required: required.length,
        missing: missing.length,
        received: received.length,
      },
      checklist: (rows ?? []).map((r: any) => ({
        id: String(r.item.id),
        code: String(r.item.code),
        title: String(r.item.title),
        description: r.item.description ?? null,
        group: String(r.item.group_name),
        required: !!r.item.required,
        status: (r.state?.status ?? "missing") as string,
        completed_at: r.state?.completed_at ?? null,
      })),
    });
  } catch (e: any) {
    console.error("[portal/checklist] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load checklist" },
      { status: 500 },
    );
  }
}
