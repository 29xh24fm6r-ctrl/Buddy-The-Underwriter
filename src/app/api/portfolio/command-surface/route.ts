import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePortfolioIntelligencePack } from "@/core/portfolio/resolvePortfolioIntelligencePack";

export const runtime = "nodejs";

/**
 * GET /api/portfolio/command-surface
 * Returns the unified portfolio intelligence pack for the banker's bank.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();
    const { data: bu } = await sb
      .from("bank_users")
      .select("bank_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!bu) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const pack = await resolvePortfolioIntelligencePack({
      bankId: bu.bank_id,
    });

    return NextResponse.json(pack);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
