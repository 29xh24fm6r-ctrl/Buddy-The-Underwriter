import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fillEngine } from "@/lib/forms/fillEngine";
import { requireUnderwriterOnDeal } from "@/lib/deals/participants";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authzError(err: any) {
  const msg = String(err?.message ?? err);
  if (msg === "unauthorized")
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (msg === "forbidden")
    return { status: 403, body: { ok: false, error: "forbidden" } };
  return null;
}

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
  const { dealId } = await ctx.params;

  try {
    const userId = await requireUnderwriterOnDeal(dealId);

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status =
        access.error === "deal_not_found"
          ? 404
          : access.error === "tenant_mismatch"
            ? 403
            : 401;
      return NextResponse.json(
        { ok: false, error: access.error },
        { status },
      );
    }

    const supabase = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const template_id = String(body?.template_id ?? "");

  if (!template_id) {
    return NextResponse.json(
      { ok: false, error: "template_id required" },
      { status: 400 },
    );
  }

    // Ensure template exists and belongs to this deal's bank
    const { data: template, error: tErr } = (await (supabase as any)
      .from("bank_document_templates")
      .select("id, bank_id")
      .eq("id", template_id)
      .maybeSingle()) as any;

    if (tErr) throw tErr;
    if (!template) {
      return NextResponse.json(
        { ok: false, error: "Template not found" },
        { status: 404 },
      );
    }

    if (String(template.bank_id) !== String(access.bankId)) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    }

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

    // Fetch deal data (extend as needed)
    const { data: deal, error: e2 } = await (supabase as any)
      .from("deals")
      .select(
        "id, borrower_name, business_name, business_ein, loan_amount, loan_purpose",
      )
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
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
