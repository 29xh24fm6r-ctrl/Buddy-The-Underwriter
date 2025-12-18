import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { downloadPrivateObject, uploadPrivateObject, createSignedDownloadUrl } from "@/lib/storage/adminStorage";
import { fillPdfFormFields } from "@/lib/bankForms/pdf";
import { buildCanonicalValuesForDeal } from "@/lib/bankForms/canonicalValues";
import { buildPdfFieldValuesFromCanonical, getActiveTemplate, getTemplateMaps } from "@/lib/bankForms/map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const bank_id = String(body?.bank_id ?? "");
    const template_key = String(body?.template_key ?? "");
    const flatten = Boolean(body?.flatten ?? false);

    if (!bank_id || !template_key) {
      return NextResponse.json({ ok: false, error: "bank_id and template_key are required" }, { status: 400 });
    }

    const template = await getActiveTemplate(bank_id, template_key);
    if (!template) {
      return NextResponse.json({ ok: false, error: `No active template for ${template_key}` }, { status: 404 });
    }

    const maps = await getTemplateMaps(template.id);

    // Pull canonical values
    const { canonical } = await buildCanonicalValuesForDeal({ dealId });

    // Map to PDF fields
    const mapped = buildPdfFieldValuesFromCanonical({ canonicalValues: canonical, maps });
    const templateBytes = await downloadPrivateObject({ bucket: "bank-templates", path: template.file_path });

    // Fill
    const filled = await fillPdfFormFields({
      pdfBytes: templateBytes,
      fieldValues: mapped.fieldValues,
      transforms: mapped.transforms,
      flatten,
    });

    // Store output
    const outPath = `${bank_id}/${dealId}/${template_key}/${Date.now()}.pdf`;
    await uploadPrivateObject({
      bucket: "filled-documents",
      path: outPath,
      bytes: filled.pdfBytes,
      contentType: "application/pdf",
      upsert: true,
    });

    const { data: row, error: e1 } = await supabaseAdmin()
      .from("filled_bank_documents")
      .insert({
        deal_id: dealId,
        bank_id,
        template_id: template.id,
        output_file_path: outPath,
        status: "GENERATED",
        metadata: {
          template_key,
          flatten,
          missing_canonical: mapped.missingCanonical,
          missing_pdf_fields: filled.missingFields,
        },
      } as any)
      .select("*")
      .single() as any;

    if (e1) throw e1;

    const signedUrl = await createSignedDownloadUrl({
      bucket: "filled-documents",
      path: outPath,
      expiresInSeconds: 60 * 10,
    });

    return NextResponse.json({
      ok: true,
      filled_document: row,
      download_url: signedUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
