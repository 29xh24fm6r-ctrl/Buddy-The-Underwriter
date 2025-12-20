import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireUnderwriterOnDeal } from "@/lib/deals/participants";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authzError(err: any) {
  const msg = String(err?.message ?? err);
  if (msg === "unauthorized") return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (msg === "forbidden") return { status: 403, body: { ok: false, error: "forbidden" } };
  return null;
}

/**
 * GET /api/deals/[dealId]/signals
 * 
 * Returns minimal signals for computing Next Best Action
 * Single source of truth for UI state
 * 
 * Returns: {
 *   ok: true,
 *   dealId: string,
 *   hasUnderwriter: boolean,
 *   queuedJobs: number,
 *   runningJobs: number,
 *   failedJobs: number,
 *   eligibleUploads: number,
 *   ocrCompletedCount: number,
 *   conditionsOutstanding: number,
 *   conditionsCritical: number,
 *   conditionsHigh: number,
 *   lastEvaluatedAt: string | null,
 *   draftMessages: number,
 *   formsReadyToGenerate: number
 * }
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    
    // TODO: Re-enable auth when Clerk is properly configured
    // Enforce underwriter access
    // await requireUnderwriterOnDeal(dealId);
    
    const supabase = supabaseAdmin();

    // Participants
    const { data: uwParts } = await (supabase as any)
      .from("deal_participants")
      .select("id")
      .eq("deal_id", dealId)
      .eq("role", "underwriter")
      .eq("is_active", true);

    const hasUnderwriter = (uwParts ?? []).length > 0;

    // Jobs
    const { data: jobs } = await (supabase as any)
      .from("document_jobs")
      .select("status")
      .eq("deal_id", dealId);

    const queuedJobs = (jobs ?? []).filter((j: any) => j.status === "QUEUED").length;
    const runningJobs = (jobs ?? []).filter((j: any) => j.status === "RUNNING").length;
    const failedJobs = (jobs ?? []).filter((j: any) => j.status === "FAILED").length;

    // Conditions
    const { data: conds } = await (supabase as any)
      .from("conditions_to_close")
      .select("status, severity, last_evaluated_at")
      .eq("deal_id", dealId);

    const outstanding = (conds ?? []).filter((c: any) => c.status !== "satisfied");
    const conditionsOutstanding = outstanding.length;
    const conditionsCritical = outstanding.filter((c: any) => c.severity === "CRITICAL").length;
    const conditionsHigh = outstanding.filter((c: any) => c.severity === "HIGH").length;
    const lastEvaluatedAt = (conds ?? [])
      .map((c: any) => c.last_evaluated_at)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

    // Messages
    const { data: msgs } = await (supabase as any)
      .from("condition_messages")
      .select("status")
      .eq("deal_id", dealId);

    const draftMessages = (msgs ?? []).filter((m: any) => m.status === "DRAFT").length;

    // Uploads / OCR results
    const { data: atts } = await (supabase as any)
      .from("borrower_attachments")
      .select("id, mime_type")
      .eq("application_id", dealId);

    const OCR_OK = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/tiff",
      "image/bmp",
      "image/webp",
    ]);
    const eligibleUploads = (atts ?? []).filter((a: any) => OCR_OK.has(a.mime_type)).length;

    const { data: ocrRes } = await (supabase as any)
      .from("document_ocr_results")
      .select("attachment_id")
      .eq("deal_id", dealId);

    const ocrCompletedCount = new Set((ocrRes ?? []).map((r: any) => r.attachment_id)).size;

    // Forms
    const { data: fillRuns } = await (supabase as any)
      .from("bank_document_fill_runs")
      .select("status")
      .eq("deal_id", dealId);

    const formsReadyToGenerate = (fillRuns ?? []).filter((r: any) => r.status === "READY").length;

    // 8. Draft borrower requests (pending approval)
    const { count: draftRequestsPending, error: e8 } = await (supabase as any)
      .from("draft_borrower_requests")
      .select("*", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "pending_approval");

    if (e8) throw e8;

    return NextResponse.json({
      ok: true,
      dealId,
      hasUnderwriter,
      queuedJobs,
      runningJobs,
      failedJobs,
      eligibleUploads,
      ocrCompletedCount,
      conditionsOutstanding,
      conditionsCritical,
      conditionsHigh,
      lastEvaluatedAt,
      draftMessages,
      formsReadyToGenerate,
      draftRequestsPending: draftRequestsPending || 0,
    });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
