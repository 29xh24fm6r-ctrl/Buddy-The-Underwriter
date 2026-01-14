// src/app/api/deals/[dealId]/snapshots/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const { userId } = await clerkAuth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const sb = supabaseAdmin();

    // Verify deal exists and belongs to bank
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // Capture current deal context from the canonical view (best-effort)
    let context: Record<string, any> = {};
    const ctxRes = await sb
      .from("deal_context_v3")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!ctxRes.error && ctxRes.data) {
      context = ctxRes.data as any;
    }

    // Create snapshot in deal_context_snapshots (canonical for downstream risk-facts)
    // NOTE: We keep context empty initially; users can build context via other flows.
    const nextVersionRes = await sb
      .from("deal_context_snapshots")
      .select("version")
      .eq("deal_id", dealId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (nextVersionRes.data?.version ?? 0) + 1;

    const { data: inserted, error: insertErr } = await sb
      .from("deal_context_snapshots")
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        version: nextVersion,
        context,
        created_by: userId,
      })
      .select("id, version, created_at")
      .single();

    if (insertErr || !inserted) {
      console.error("Failed to create snapshot:", insertErr);
      return NextResponse.json(
        { ok: false, error: "Failed to create snapshot" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      snapshot: {
        id: inserted.id,
        version: inserted.version,
        created_at: inserted.created_at,
      },
    });
  } catch (e: any) {
    console.error("POST /api/deals/[dealId]/snapshots error:", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Get all snapshots for this deal
    const { data: snapshots, error } = await sb
      .from("deal_context_snapshots")
      .select("id, deal_id, bank_id, version, created_at, updated_at, created_by")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch snapshots:", error);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch snapshots" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, snapshots: snapshots ?? [] });
  } catch (e: any) {
    console.error("GET /api/deals/[dealId]/snapshots error:", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
