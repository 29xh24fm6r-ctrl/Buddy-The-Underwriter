import "server-only";

/**
 * POST /api/brokerage/deals/[dealId]/trident/generate
 *
 * Manual trigger for bundle generation. Admin-only for v1 (brokerage tenant
 * member). Not exposed to borrowers directly — borrowers download via the
 * separate `/trident/download/[kind]` route which is gated by the
 * session-cookie-owns-this-deal check.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateTridentBundle } from "@/lib/brokerage/trident/generateTridentBundle";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "unauthenticated" },
      { status: 401 },
    );
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const { data: membership } = await sb
    .from("bank_user_memberships")
    .select("role")
    .eq("bank_id", brokerageBankId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    mode?: "preview" | "final";
  };
  const mode = body.mode ?? "preview";

  const result = await generateTridentBundle({ dealId, mode });
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}
