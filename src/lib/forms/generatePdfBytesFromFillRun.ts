import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fillEngine } from "@/lib/forms/fillEngine";
import { fillPdfTemplate } from "@/lib/forms/pdfFill";

/**
 * Shared core for generating a filled PDF from a fill_run_id.
 * This is the ONE place that understands:
 * - fill_runs (template_code, context)
 * - template_fields (AcroForm fields extracted)
 * - fillEngine (rules-based mapping)
 * - fillPdfTemplate (produce final PDF bytes)
 *
 * Used by:
 * - SBA Package Builder (generatePdfForFillRun)
 * - Forms generate route (can be refactored to use this)
 */
export async function generatePdfBytesFromFillRun(opts: {
  supabase: SupabaseClient;
  dealId: string;
  fillRunId: string;
}): Promise<{ templateCode: string; fileName: string; pdfBytes: Buffer }> {
  const { supabase, dealId, fillRunId } = opts;

  // 1) Load fill run
  const { data: fr, error: frErr } = await supabase
    .from("fill_runs")
    .select("id, template_code, context, deal_id")
    .eq("id", fillRunId)
    .limit(1)
    .maybeSingle();

  if (frErr) throw new Error(`fill_run_load_failed: ${frErr.message}`);
  if (!fr) throw new Error(`fill_run_not_found: ${fillRunId}`);

  const templateCode = (fr.template_code as string | null) ?? null;
  if (!templateCode) throw new Error(`fill_run_missing_template_code: ${fillRunId}`);

  const context = (fr.context ?? {}) as any;

  // 2) Load template fields (AcroForm field registry)
  // Note: using bank_document_template_fields table - adjust if your schema differs
  const { data: templateRecord, error: tErr } = await supabase
    .from("bank_document_templates")
    .select("id, storage_path")
    .eq("code", templateCode)
    .limit(1)
    .maybeSingle();

  if (tErr) throw new Error(`template_lookup_failed(${templateCode}): ${tErr.message}`);
  if (!templateRecord) throw new Error(`template_not_found: ${templateCode}`);

  const templateId = templateRecord.id as string;
  const storagePath = templateRecord.storage_path as string;

  // 3) Load template fields
  const { data: fields, error: fErr } = await supabase
    .from("bank_document_template_fields")
    .select("field_name, is_required")
    .eq("template_id", templateId);

  if (fErr) throw new Error(`template_fields_load_failed(${templateCode}): ${fErr.message}`);

  // 4) Compute field values deterministically using fillEngine
  const engineResult = await fillEngine(
    {
      dealId,
      templateId,
      dealData: {
        borrower_name: context.normalized?.borrowerName ?? context.answers?.borrower_name,
        business_name: context.normalized?.businessName ?? context.answers?.business_name,
        business_ein: context.answers?.business_ein ?? context.answers?.ein,
        loan_amount: context.normalized?.loanAmount ?? context.answers?.loan_amount,
        loan_purpose: context.answers?.loan_purpose,
      },
    },
    fields ?? []
  );

  // 5) Load raw PDF template bytes from Supabase storage
  const { data: fileData, error: dlErr } = await supabase.storage
    .from("bank-documents")
    .download(storagePath);

  if (dlErr) throw new Error(`template_download_failed(${templateCode}): ${dlErr.message}`);

  const templateBytes = Buffer.from(await fileData.arrayBuffer());

  // 6) Fill PDF
  const fillResult = await fillPdfTemplate(templateBytes, engineResult.field_values, {
    flatten: true,
  });

  if (!fillResult.ok) {
    throw new Error(`pdf_fill_failed(${templateCode}): ${fillResult.error}`);
  }

  if (!fillResult.pdfBytes) {
    throw new Error(`pdf_fill_returned_no_bytes(${templateCode})`);
  }

  const fileName = `${templateCode}.pdf`;
  return { templateCode, fileName, pdfBytes: fillResult.pdfBytes };
}
