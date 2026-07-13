import "server-only";

/** SPEC S3 B-7 — GET /api/deals/[dealId]/esign/status/[submissionId] */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { fetchDocusealSubmission } from "@/lib/esign/docuseal/client";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; submissionId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, submissionId } = await ctx.params;
    const { dealId } = await assertDealAccess(rawDealId);

    const sb = supabaseAdmin();
    const { data: signedDoc } = await sb
      .from("signed_documents")
      .select("*")
      .eq("deal_id", dealId)
      .eq("docuseal_submission_id", submissionId)
      .maybeSingle();

    if (signedDoc) {
      return NextResponse.json({ ok: true, status: "completed", signedDocument: signedDoc });
    }

    const submission = await fetchDocusealSubmission(submissionId);
    return NextResponse.json({ ok: true, status: submission.status, submission });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/esign/status/[submissionId]]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
