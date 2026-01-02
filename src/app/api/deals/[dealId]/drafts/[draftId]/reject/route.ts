// src/app/api/deals/[dealId]/drafts/[draftId]/reject/route.ts

import { NextRequest, NextResponse } from "next/server";
import { clerkCurrentUser } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRow = {
  id: string;
  deal_id: string;
  status: string;
  subject: string | null;
  body: string | null;
  kind: string | null;
  fingerprint: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; draftId: string }> },
) {
  try {
    const { dealId, draftId } = await ctx.params;

    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "missing_dealId" },
        { status: 400 },
      );
    }
    if (!draftId) {
      return NextResponse.json(
        { ok: false, error: "missing_draftId" },
        { status: 400 },
      );
    }

    // Auth
    const user = await clerkCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401 },
      );
    }

    // Parse body
    const body = await req.json().catch(() => ({}));
    const reason = String(body?.reason ?? "No reason provided");

    const sb = supabaseAdmin();

    const patch: Record<string, any> = {
      status: "rejected",
      rejected_by: user.id,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    };

    // IMPORTANT: Cast the table query to `any` so `.update()` doesn't type as `never`.
    const q = (sb.from("deal_message_drafts") as any)
      .update(patch)
      .eq("id", draftId)
      .eq("deal_id", dealId)
      .eq("status", "pending_approval") // only reject pending drafts
      .select("*")
      .maybeSingle();

    const { data: draft, error } = (await q) as {
      data: DraftRow | null;
      error: any;
    };

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message ?? String(error) },
        { status: 500 },
      );
    }

    if (!draft) {
      return NextResponse.json(
        { ok: false, error: "Draft not found or already processed" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, draft });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err ?? "unknown_error") },
      { status: 500 },
    );
  }
}
