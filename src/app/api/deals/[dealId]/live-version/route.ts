// src/app/api/deals/[dealId]/live-version/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  created_at?: string | null;
  updated_at?: string | null;
  uploaded_at?: string | null;
  last_activity_at?: string | null;
};

function asMs(x?: string | null) {
  if (!x) return 0;
  const t = new Date(x).getTime();
  return Number.isFinite(t) ? t : 0;
}

async function latestMs(
  sb: ReturnType<typeof supabaseAdmin>,
  table: string,
  dealId: string,
  col: string,
) {
  const { data, error } = await sb
    .from(table)
    .select(col)
    .eq("deal_id", dealId)
    .order(col, { ascending: false })
    .limit(1);

  if (error) return 0;
  const row = (data?.[0] as Row) || {};
  return asMs((row as any)[col]);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
  } catch (e) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    // Graceful degradation for unauthorized requests
    return NextResponse.json({ ok: true, version: 0 }, { status: 200 });
  }

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    // Add/remove tables as your UI grows.
    const candidates = await Promise.all([
      latestMs(sb, "borrower_document_requests", dealId, "updated_at"),
      latestMs(sb, "borrower_uploads", dealId, "uploaded_at"),
      latestMs(sb, "borrower_messages", dealId, "created_at"),
      latestMs(sb, "deal_conditions", dealId, "updated_at"),
      latestMs(sb, "credit_discovery_sessions", dealId, "updated_at"),
      latestMs(sb, "owner_requirements", dealId, "updated_at"),
      latestMs(sb, "doc_intel_results", dealId, "created_at"),
      latestMs(sb, "ai_events", dealId, "created_at"),
    ]);

    const version = Math.max(0, ...candidates);

    return NextResponse.json({ ok: true, version });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.warn("[live-version] Error (returning version:0):", e);
    return NextResponse.json({ ok: true, version: 0 });
  }
}
