import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fillPdfTemplate } from "@/lib/forms/pdfFill";
import { requireUnderwriterOnDeal } from "@/lib/deals/participants";

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
 * POST /api/deals/[dealId]/forms/generate
 *
 * Generates filled PDF from a fill run
 * Requires underwriter role on deal
 *
 * Body: { fill_run_id: string, flatten?: boolean }
 * Returns: { ok: true, document_id: string, download_url: string }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  requireSuperAdmin();
  const { dealId } = await ctx.params;
  const supabase = supabaseAdmin();

  try {
    // Enforce underwriter access
    await requireUnderwriterOnDeal(dealId);

    const body = await req.json().catch(() => ({}));
    const fill_run_id = String(body?.fill_run_id ?? "");
    const flatten = Boolean(body?.flatten ?? true);

    if (!fill_run_id) {
      return NextResponse.json(
        { ok: false, error: "fill_run_id required" },
        { status: 400 },
      );
    }

    // Fetch fill run
    const { data: fillRun, error: e1 } = await (supabase as any)
      .from("bank_document_fill_runs")
      .select("*, bank_document_templates!inner(*)")
      .eq("id", fill_run_id)
      .eq("deal_id", dealId)
      .single();

    if (e1) throw e1;
    if (!fillRun) {
      return NextResponse.json(
        { ok: false, error: "Fill run not found" },
        { status: 404 },
      );
    }

    // Fetch template file bytes
    const templatePath = fillRun.bank_document_templates.storage_path;
    const { data: fileData, error: e2 } = await (supabase as any).storage
      .from("bank-documents")
      .download(templatePath);

    if (e2) throw e2;

    const templateBytes = Buffer.from(await fileData.arrayBuffer());

    // Fill PDF
    const fillResult = await fillPdfTemplate(
      templateBytes,
      fillRun.field_values,
      { flatten },
    );

    if (!fillResult.ok) {
      // Mark fill run as failed
      await (supabase as any)
        .from("bank_document_fill_runs")
        .update({
          status: "FAILED",
          error: fillResult.error,
          updated_at: new Date().toISOString(),
        })
        .eq("id", fill_run_id);

      return NextResponse.json(
        { ok: false, error: fillResult.error },
        { status: 500 },
      );
    }

    // Upload filled PDF to storage
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${dealId}/filled_${fillRun.bank_document_templates.document_type}_${timestamp}.pdf`;

    const { error: e3 } = await (supabase as any).storage
      .from("bank-documents")
      .upload(filename, fillResult.pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (e3) throw e3;

    // Create filled document record
    const { data: filledDoc, error: e4 } = await (supabase as any)
      .from("filled_bank_documents")
      .insert({
        template_id: fillRun.template_id,
        deal_id: dealId,
        storage_path: filename,
        fill_run_id,
      })
      .select()
      .single();

    if (e4) throw e4;

    // Mark fill run as generated
    await (supabase as any)
      .from("bank_document_fill_runs")
      .update({
        status: "GENERATED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", fill_run_id);

    // Generate signed download URL (1 hour expiry)
    const { data: urlData } = await (supabase as any).storage
      .from("bank-documents")
      .createSignedUrl(filename, 3600);

    return NextResponse.json({
      ok: true,
      document_id: filledDoc.id,
      download_url: urlData?.signedUrl ?? null,
      filename,
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
