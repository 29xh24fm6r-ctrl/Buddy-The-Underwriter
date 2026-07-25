import "server-only";

/**
 * POST /api/deals/[dealId]/sba/legal-review
 *
 * Marks a Buddy-generated closing document (SBA Note, Loan Authorization)
 * as attorney/compliance-reviewed and approved for signature — the gate
 * src/lib/esign/signwell/service.ts's requestSignature() checks before
 * ever sending one of these documents to SignWell. Restricted to
 * bank_admin/super_admin: reviewing a Buddy-drafted legal document for
 * execution is a more senior action than routine underwriting cockpit
 * access (COCKPIT_ROLES also allows "underwriter").
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealCockpitAccess } from "@/lib/auth/requireDealCockpitAccess";
import { markLegalReviewApproved, FORMS_REQUIRING_LEGAL_REVIEW } from "@/lib/sba/legalReview/service";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, ["super_admin", "bank_admin"]);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const formCode = (body as Record<string, unknown> | null)?.form_code;
  const notes = (body as Record<string, unknown> | null)?.notes;

  if (typeof formCode !== "string" || !FORMS_REQUIRING_LEGAL_REVIEW.has(formCode)) {
    return NextResponse.json(
      { ok: false, error: "invalid_form_code", allowed: [...FORMS_REQUIRING_LEGAL_REVIEW] },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const result = await markLegalReviewApproved(
    {
      dealId: auth.dealId,
      bankId: auth.bankId,
      formCode,
      reviewedBy: auth.userId,
      notes: typeof notes === "string" ? notes : null,
    },
    sb,
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
