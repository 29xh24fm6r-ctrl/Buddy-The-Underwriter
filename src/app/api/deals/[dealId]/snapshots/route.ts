// src/app/api/deals/[dealId]/snapshots/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { auth } from "@clerk/nextjs/server";
import type { DealSnapshot } from "@/lib/deals/contextTypes";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const { userId } = await auth();

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

    // Create immutable snapshot
    const snapshotId = `${dealId}_${Date.now()}`;
    const now = new Date().toISOString();

    const { error: insertErr } = await sb.from("deal_snapshots").insert({
      id: snapshotId,
      deal_id: dealId,
      bank_id: bankId,
      immutable: true,
      created_at: now,
      created_by: userId,
    });

    if (insertErr) {
      console.error("Failed to create snapshot:", insertErr);
      return NextResponse.json(
        { ok: false, error: "Failed to create snapshot" },
        { status: 500 }
      );
    }

    const snapshot: DealSnapshot = {
      snapshotId,
      dealId,
      immutable: true,
      createdAt: now,
      createdBy: userId,
    };

    return NextResponse.json({ ok: true, snapshot });
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
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Get all snapshots for this deal
    const { data: snapshots, error } = await sb
      .from("deal_snapshots")
      .select("*")
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
