import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/files/upload-health
 *
 * Compares deal_upload_session_files count vs deal_documents count.
 * Returns gap_detected: true if session_files > deal_documents,
 * indicating some uploads were not persisted to deal_documents.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
): Promise<NextResponse> {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const bankId = await getCurrentBankId();
    const { dealId } = await ctx.params;

    if (!dealId) {
      return NextResponse.json({ ok: false, error: "missing_deal_id" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Verify deal belongs to caller's bank
    const { data: dealCheck } = await sb
      .from("deals")
      .select("id")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle();

    if (!dealCheck) {
      return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
    }

    const [sessionFilesRes, dealDocsRes] = await Promise.all([
      sb
        .from("deal_upload_session_files")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId),
      sb
        .from("deal_documents")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId),
    ]);

    const sessionFilesCount = sessionFilesRes.count ?? 0;
    const dealDocumentsCount = dealDocsRes.count ?? 0;
    const gapDetected = sessionFilesCount > dealDocumentsCount;
    const gapCount = Math.max(sessionFilesCount - dealDocumentsCount, 0);

    if (gapDetected) {
      void writeEvent({
        dealId,
        kind: "upload.docs_not_recorded",
        scope: "intake",
        meta: {
          expected: sessionFilesCount,
          actual: dealDocumentsCount,
          gap: gapCount,
          bank_id: bankId,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      session_files_count: sessionFilesCount,
      deal_documents_count: dealDocumentsCount,
      gap_detected: gapDetected,
      gap_count: gapCount,
    });
  } catch (err: any) {
    console.error("[upload-health] Error:", err?.message);
    return NextResponse.json(
      { ok: false, error: "internal_error", details: err?.message },
      { status: 500 },
    );
  }
}
