import "server-only";

/**
 * GET /api/lender/marketplace/package/[accessId]
 *
 * Full sealed-package access for the lender the borrower picked. Gated by a
 * marketplace_package_access row (the accessId) that must belong to THIS lender
 * and not be revoked — never by the URL alone. 404 on any mismatch (no existence leak).
 * route-class: CLERK (lender).
 *
 * Delegates to getLenderPackageAccess (packageDelivery.ts) for the deal
 * summary + download manifest — that function already implemented this
 * exact access check independently and correctly, but (until now) had zero
 * callers anywhere in the app; this route was reinventing a smaller subset
 * of the same check by hand. package.deal_summary/manifest let the client
 * render real download buttons instead of a raw JSON dump of the sealed
 * snapshot.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveLenderIdentity } from "@/lib/brokerage/lenderAuth";
import { getLenderPackageAccess } from "@/lib/brokerage/packageDelivery";

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

  const result = await getLenderPackageAccess(accessId, lender.lenderBankId, supabaseAdmin() as any);
  if (!result.ok) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    dealId: result.access.dealId,
    accessLevel: result.access.accessLevel,
    dealSummary: result.access.dealSummary,
    manifest: result.access.manifest,
  });
}
