import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { autoMatchChecklistFromFilename } from "@/lib/deals/autoMatchChecklistFromFilename";
import { reconcileUploadsForDeal } from "@/lib/documents/reconcileUploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRequestId(req: NextRequest) {
  return (
    req.headers.get("x-request-id") ||
    req.headers.get("x-buddy-request-id") ||
    crypto.randomUUID()
  );
}

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms),
    ),
  ]);
}

/**
 * POST /api/deals/[dealId]/files/auto-match-checklist
 * 
 * Manually trigger auto-matching of uploaded files to checklist items.
 * Useful when files were uploaded before checklist was seeded, or to re-match.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const requestId = getRequestId(req);
  try {
    const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", requestId },
        { status: 401 },
      );
    }

    const { dealId } = await ctx.params;
    const bankId = await withTimeout(getCurrentBankId(), 10_000, "getCurrentBankId");
    const sb = supabaseAdmin();

    // Tenant enforcement: ensure deal belongs to the active bank.
    const { data: deal, error: dealErr } = await withTimeout(
      sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle(),
      10_000,
      "dealLookup",
    );
    if (dealErr) {
      return NextResponse.json(
        { ok: false, error: dealErr.message, requestId },
        { status: 500 },
      );
    }
    if (!deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found", requestId },
        { status: 404 },
      );
    }
    if (deal.bank_id !== bankId) {
      return NextResponse.json(
        { ok: false, error: "tenant_mismatch", requestId },
        { status: 403 },
      );
    }

    // Ensure borrower portal uploads are materialized into deal_documents first.
    const reconcileRes = await withTimeout(
      reconcileUploadsForDeal(dealId, bankId),
      25_000,
      "reconcileUploadsForDeal",
    );

    // Get all files for this deal
    const rpcRes: any = await withTimeout(
      sb.rpc("list_deal_documents", { p_deal_id: dealId }),
      15_000,
      "list_deal_documents",
    );

    const files: any[] | null = rpcRes?.data ?? null;
    const filesError: any = rpcRes?.error ?? null;

    if (filesError) {
      return NextResponse.json(
        { ok: false, error: filesError.message, requestId },
        { status: 500 },
      );
    }

    if (!files || files.length === 0) {
      return NextResponse.json({
        ok: true,
        requestId,
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
    let filesWithMatches = 0;
    let filesLinked = 0;
    const results: Array<{ filename: string; matched: string[]; updated: number }> = [];

    for (const file of files) {
      const result = await withTimeout(
        autoMatchChecklistFromFilename({
          dealId,
          filename: String(file.original_filename || file.original_name || ""),
          fileId: String(file.id || file.file_id || ""),
        }),
        12_000,
        "autoMatchChecklistFromFilename",
      );

      if (result.matched.length > 0) {
        filesWithMatches += 1;
        totalMatched += result.matched.length;
        totalUpdated += result.updated;
        results.push({
          filename: String(file.original_filename || file.original_name || ""),
          matched: result.matched,
          updated: result.updated,
        });

        // Update the file's checklist_key if not already set
        if (!file.checklist_key && result.matched.length > 0) {
          await withTimeout(
            sb
              .from("deal_documents")
              .update({ checklist_key: result.matched[0] })
              .eq("id", String(file.id || file.file_id || "")),
            10_000,
            "update_deal_documents_checklist_key",
          );

          filesLinked += 1;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      requestId,
      filesProcessed: files.length,
      totalMatched,
      filesWithMatches,
      filesLinked,
      totalUpdated,
      results,
      reconciled: reconcileRes.matched,
    });
  } catch (e: unknown) {
    const requestId = getRequestId(req);
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.startsWith("timeout:") ? 504 : 500;
    return NextResponse.json({ ok: false, error: msg, requestId }, { status });
  }
}
