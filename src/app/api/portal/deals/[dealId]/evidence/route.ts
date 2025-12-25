import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import {
  isBorrowerSafeScope,
  sanitizeEvidenceEvent,
} from "@/lib/portal/sanitizeEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const invite = await requireValidInvite(token);

    const { dealId } = await ctx.params;
    if (invite.deal_id !== dealId) throw new Error("Deal ID mismatch");

    const url = new URL(req.url);
    const scope = String(url.searchParams.get("scope") || "");
    const limit = Math.max(
      1,
      Math.min(20, Number(url.searchParams.get("limit") || 10)),
    );

    if (!isBorrowerSafeScope(scope)) {
      return NextResponse.json({ ok: true, events: [] });
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("ai_events")
      .select("id, scope, action, confidence, evidence_json, created_at")
      .eq("deal_id", dealId)
      .eq("scope", scope)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      events: (data || []).map(sanitizeEvidenceEvent),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "portal_evidence_failed" },
      { status: 500 },
    );
  }
}
