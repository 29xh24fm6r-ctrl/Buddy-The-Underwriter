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
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateTridentBundle } from "@/lib/brokerage/trident/generateTridentBundle";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { getTridentReadiness } from "@/lib/brokerage/trident/tridentReadiness";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  try {
    await requireBrokerageStaff();
  } catch (error) {
    const message = error instanceof Error ? error.message : "forbidden";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "unauthorized" ? 401 : 403 },
    );
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();
  if (!deal) {
    return NextResponse.json({ ok: false, error: "deal_not_found_for_brokerage" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    mode?: "preview" | "final";
  };
  const mode = body.mode ?? "preview";

  if (mode === "final") {
    const readiness = await getTridentReadiness({ sb, dealId, bankId: brokerageBankId });
    if (!readiness.ok) {
      return NextResponse.json(
        { ok: false, error: "trident_not_ready", reasons: readiness.reasons, evidence: readiness.evidence },
        { status: 409 },
      );
    }
  }

  const result = await generateTridentBundle({ dealId, mode });
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}
