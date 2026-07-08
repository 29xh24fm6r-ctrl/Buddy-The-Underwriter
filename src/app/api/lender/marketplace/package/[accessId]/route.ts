import "server-only";

/**
 * GET /api/lender/marketplace/package/[accessId]
 *
 * Full sealed-package access for the lender the borrower picked. Gated by a
 * marketplace_package_access row (the accessId) that must belong to THIS lender
 * and not be revoked — never by the URL alone. 404 on any mismatch (no existence leak).
 * route-class: CLERK (lender).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveLenderIdentity } from "@/lib/brokerage/lenderAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ accessId: string }> },
): Promise<NextResponse> {
  const { accessId } = await params;
  const lender = await resolveLenderIdentity();
  if (!lender) {
    return NextResponse.json({ ok: false, error: "not_a_lender" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: access } = await sb
    .from("marketplace_package_access")
    .select("id, lender_bank_id, sealed_package_id, deal_id, access_level, revoked_at")
    .eq("id", accessId)
    .maybeSingle();

  if (
    !access ||
    (access as any).lender_bank_id !== lender.lenderBankId ||
    (access as any).revoked_at
  ) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const { data: pkg } = await sb
    .from("buddy_sealed_packages")
    .select("sealed_snapshot")
    .eq("id", (access as any).sealed_package_id)
    .maybeSingle();

  if (!pkg) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    dealId: (access as any).deal_id,
    accessLevel: (access as any).access_level,
    package: (pkg as any).sealed_snapshot,
  });
}
