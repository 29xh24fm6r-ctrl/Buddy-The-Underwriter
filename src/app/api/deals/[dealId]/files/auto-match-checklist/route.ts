import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { autoMatchChecklistFromFilename } from "@/lib/deals/autoMatchChecklistFromFilename";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileUploadsForDeal } from "@/lib/documents/reconcileUploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/files/auto-match-checklist
 * 
 * Manually trigger auto-matching of uploaded files to checklist items.
 * Useful when files were uploaded before checklist was seeded, or to re-match.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { dealId } = await ctx.params;
  const ensured = await ensureDealBankAccess(dealId);
  if (!ensured.ok) {
    const statusCode =
      ensured.error === "deal_not_found" ? 404 :
      ensured.error === "tenant_mismatch" ? 403 :
      401;
    return NextResponse.json(
      { ok: false, error: ensured.error },
      { status: statusCode },
    );
  }

  const sb = supabaseAdmin();

  // Ensure borrower portal uploads are materialized into deal_documents first.
  // This makes Auto-Match truly end-to-end.
  const reconcileRes = await reconcileUploadsForDeal(dealId, ensured.bankId);

  // Get all files for this deal
  const { data: files, error: filesError } = await sb
    .rpc("list_deal_documents", { p_deal_id: dealId });

  if (filesError) {
    return NextResponse.json(
      { ok: false, error: filesError.message },
      { status: 500 },
    );
  }

  if (!files || files.length === 0) {
    return NextResponse.json({
      ok: true,
      message:
        reconcileRes.matched > 0
          ? "Uploads reconciled, but no files found to match"
          : "No files found to match",
      matched: 0,
      updated: 0,
      reconciled: reconcileRes.matched,
    });
  }

  // Try to match each file
  let totalMatched = 0;
  let totalUpdated = 0;
  const results: Array<{ filename: string; matched: string[]; updated: number }> = [];

  for (const file of files) {
    const result = await autoMatchChecklistFromFilename({
      dealId,
      filename: file.original_filename,
      fileId: file.id,
    });

    if (result.matched.length > 0) {
      totalMatched += result.matched.length;
      totalUpdated += result.updated;
      results.push({
        filename: file.original_filename,
        matched: result.matched,
        updated: result.updated,
      });

      // Update the file's checklist_key if not already set
      if (!file.checklist_key && result.matched.length > 0) {
        await sb
          .from("deal_documents")
          .update({ checklist_key: result.matched[0] })
          .eq("id", file.id);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    filesProcessed: files.length,
    totalMatched,
    totalUpdated,
    results,
    reconciled: reconcileRes.matched,
  });
}
