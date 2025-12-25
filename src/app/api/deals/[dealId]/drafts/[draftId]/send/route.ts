// src/app/api/deals/[dealId]/drafts/[draftId]/send/route.ts

import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
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

  sent_at: string | null;
  sent_via: string | null;
};

export async function POST(
  _req: NextRequest,
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
    const user = await currentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401 },
      );
    }

    const sb = supabaseAdmin();

    // 1) Ensure draft exists + is approved (only approved drafts can be sent)
    const { data: existing, error: e0 } = await sb
      .from("deal_message_drafts")
      .select("*")
      .eq("id", draftId)
      .eq("deal_id", dealId)
      .maybeSingle<DraftRow>();

    if (e0) {
      return NextResponse.json(
        { ok: false, error: e0.message },
        { status: 500 },
      );
    }

    if (!existing || existing.status !== "approved") {
      return NextResponse.json(
        { ok: false, error: "Draft not found or not approved" },
        { status: 404 },
      );
    }

    // NOTE: We are NOT sending real emails yet (per your request).
    // This endpoint just marks the draft as "sent" so banker can copy/paste externally.

    const patch: Record<string, any> = {
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_via: "email", // or "portal_notification" later
      updated_at: new Date().toISOString(),
      // optional audit fields if you add them later:
      sent_by: user.id,
    };

    // 2) Update to sent (cast table query to `any` to avoid `never` update payload typing)
    const q = (sb.from("deal_message_drafts") as any)
      .update(patch)
      .eq("id", draftId)
      .eq("deal_id", dealId)
      .eq("status", "approved") // only send approved drafts
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
