import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fillEngine } from "@/lib/forms/fillEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/forms/prepare
 *
 * Creates a fill run and prepares field values using deterministic rules
 * Returns missing fields + ready status for review
 *
 * Body: { template_id: string }
 * Returns: {
 *   ok: true,
 *   fill_run_id: string,
 *   status: string,
 *   field_values: Record<string, string>,
 *   missing_required_fields: string[],
 *   ai_notes: Record<string, string>
 * }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  requireSuperAdmin();
  const { userId } = await clerkAuth();
  const { dealId } = await ctx.params;
  const supabase = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const template_id = String(body?.template_id ?? "");

  if (!template_id) {
    return NextResponse.json(
      { ok: false, error: "template_id required" },
      { status: 400 },
    );
  }

  try {
    // Fetch template fields
    const { data: fields, error: e1 } = await (supabase as any)
      .from("bank_document_template_fields")
      .select("field_name, is_required")
      .eq("template_id", template_id);

    if (e1) throw e1;
    if (!fields || fields.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Template has no parsed fields. Upload template again to parse.",
        },
        { status: 400 },
      );
    }

    // Fetch deal data (simplified - extend based on your schema)
    const { data: deal, error: e2 } = await (supabase as any)
      .from("applications")
      .select("*")
      .eq("id", dealId)
      .single();

    if (e2) throw e2;

    // Fetch OCR data if available (from document_ocr_results)
    const { data: ocrResults } = await (supabase as any)
      .from("document_ocr_results")
      .select("extracted_text, tables_json")
      .eq("deal_id", dealId)
      .limit(1)
      .maybeSingle();

    // Run fill engine
    const fillResult = await fillEngine(
      {
        dealId,
        templateId: template_id,
        dealData: {
          borrower_name: deal?.borrower_name,
          business_name: deal?.business_name,
          business_ein: deal?.business_ein,
          loan_amount: deal?.loan_amount,
          loan_purpose: deal?.loan_purpose,
        },
        ocrData: ocrResults
          ? {
              extracted_text: ocrResults.extracted_text,
              tables: ocrResults.tables_json,
            }
          : undefined,
      },
      fields,
    );

    // Determine status
    const status =
      fillResult.missing_required_fields.length > 0 ? "DRAFT" : "READY";

    // Create fill run
    const { data: fillRun, error: e3 } = await (supabase as any)
      .from("bank_document_fill_runs")
      .insert({
        template_id,
        deal_id: dealId,
        created_by_clerk_user_id: userId,
        status,
        field_values: fillResult.field_values,
        ai_notes: fillResult.ai_notes ?? {},
      })
      .select()
      .single();

    if (e3) throw e3;

    return NextResponse.json({
      ok: true,
      fill_run_id: fillRun.id,
      status: fillRun.status,
      field_values: fillResult.field_values,
      missing_required_fields: fillResult.missing_required_fields,
      evidence: fillResult.evidence,
      ai_notes: fillResult.ai_notes,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? String(error) },
      { status: 500 },
    );
  }
}
