import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fillPdfTemplate } from "@/lib/forms/pdfFill";
import type { Sba159Fields } from "@/lib/sba/forms/build159";

/**
 * Fills the official SBA Form 159 PDF (ingested via
 * scripts/ingest-sba-templates.ts, which commits it under
 * public/sba-templates/ and records its bank_document_templates row) with
 * the payload from buildSbaForm159, uploads the result to deal-documents,
 * and returns its storage path.
 *
 * Principle #28 (ARC-00): never fabricate a filled PDF. If the official
 * template hasn't been ingested yet, this returns
 * `{ ok: false, reason: "template_not_ingested" }` rather than producing
 * output — callers store the real payload regardless and leave
 * generated_pdf_path null until the template exists.
 */

const OUTPUT_BUCKET = "deal-documents";

// Best-effort mapping from our payload keys to plausible AcroForm field
// names. The real 159 template hasn't been ingested yet (Phase 0.C is
// blocked on outbound access to sba.gov in this environment), so these
// aliases are provisional — verify against bank_document_template_fields
// once scripts/ingest-sba-templates.ts has actually run and adjust here.
function toFieldValues(fields: Sba159Fields): Record<string, string> {
  const values: Record<string, string> = {};
  if (fields.applicant_name) values["Applicant Name"] = fields.applicant_name;
  if (fields.loan_amount != null) values["Loan Amount"] = String(fields.loan_amount);
  values["Agent Name"] = fields.agent.name;
  values["Agent Type"] = fields.agent.type;
  if (fields.agent.address) values["Agent Address"] = fields.agent.address;
  if (fields.compensation_description) values["Services Performed"] = fields.compensation_description;
  values["Total Compensation"] = `$${(fields.total_compensation_cents / 100).toLocaleString()}`;
  return values;
}

export async function renderForm159Pdf(args: {
  supabase: SupabaseClient;
  dealId: string;
  fields: Sba159Fields;
}): Promise<
  | { ok: true; storagePath: string }
  | { ok: false; reason: "template_not_ingested" | "template_download_failed" | "fill_failed"; detail?: string }
> {
  const { supabase, dealId, fields } = args;

  const { data: template } = await supabase
    .from("bank_document_templates")
    .select("id, file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_159")
    .eq("is_active", true)
    .maybeSingle();

  if (!template?.file_path) {
    return { ok: false, reason: "template_not_ingested" };
  }

  let templateBytes: Buffer;
  try {
    // scripts/ingest-sba-templates.ts commits official PDFs under
    // public/sba-templates/ and records that relative path as file_path.
    templateBytes = await readFile(path.join(process.cwd(), "public", template.file_path));
  } catch (err: any) {
    return { ok: false, reason: "template_download_failed", detail: err?.message ?? String(err) };
  }
  const fillResult = await fillPdfTemplate(templateBytes, toFieldValues(fields), { flatten: true });
  if (!fillResult.ok || !fillResult.pdfBytes) {
    return { ok: false, reason: "fill_failed", detail: fillResult.error };
  }

  const storagePath = `sba-forms/159/${dealId}/${Date.now()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(OUTPUT_BUCKET)
    .upload(storagePath, fillResult.pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    return { ok: false, reason: "fill_failed", detail: uploadError.message };
  }

  return { ok: true, storagePath };
}
