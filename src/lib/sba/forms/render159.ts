import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { normalizeInvertedWidgetRects } from "@/lib/sba/forms/pdfRectFix";
import type { Sba159Fields } from "@/lib/sba/forms/build159";
import {
  FORM_159_TEXT_FIELDS,
  FORM_159_CHECKBOX_FIELDS,
  FEE_TYPE_TO_GRID_ROW,
} from "@/lib/sba/forms/form159/pdfFieldMap";

const OUTPUT_BUCKET = "deal-documents";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildFieldValues(fields: Sba159Fields): {
  text: Record<string, string>;
  checkboxes: Record<string, boolean>;
} {
  const text: Record<string, string> = {};
  const checkboxes: Record<string, boolean> = {};

  const setText = (key: keyof typeof FORM_159_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    text[FORM_159_TEXT_FIELDS[key]] = String(value);
  };

  if (fields.applicant_name) setText("sba_loan_name", fields.applicant_name);
  if (fields.lender.name) setText("sba_lender_legal_name", fields.lender.name);

  setText("agent_name", fields.agent.name);
  if (fields.agent.address) setText("agent_address", fields.agent.address);

  checkboxes[FORM_159_CHECKBOX_FIELDS.agent_type_independent_loan_packager] = true;
  checkboxes[FORM_159_CHECKBOX_FIELDS.itemization_attached] = fields.fees.length > 0;

  let totalApplicantCents = 0;
  let totalLenderCents = 0;

  for (const fee of fields.fees) {
    const gridRow = FEE_TYPE_TO_GRID_ROW[fee.fee_type];
    const column = fee.payer_type === "lender" ? "lender" : "applicant";

    if (fee.amount_cents != null) {
      const formatted = formatCents(fee.amount_cents);
      if (gridRow) {
        setText(gridRow[column], formatted);
      } else {
        setText(column === "applicant" ? "applicant_other" : "lender_other", formatted);
        if (!text[FORM_159_TEXT_FIELDS.other_service_description]) {
          setText("other_service_description", fee.description);
        }
      }

      if (column === "applicant") totalApplicantCents += fee.amount_cents;
      else totalLenderCents += fee.amount_cents;
    }
  }

  if (totalApplicantCents > 0) setText("total_applicant", formatCents(totalApplicantCents));
  if (totalLenderCents > 0) setText("total_lender", formatCents(totalLenderCents));

  return { text, checkboxes };
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
    templateBytes = await readFile(path.join(process.cwd(), "public", template.file_path));
  } catch (err: any) {
    return { ok: false, reason: "template_download_failed", detail: err?.message ?? String(err) };
  }

  try {
    const { text, checkboxes } = buildFieldValues(fields);
    const pdfDoc = await PDFDocument.load(templateBytes);
    normalizeInvertedWidgetRects(pdfDoc);
    const form = pdfDoc.getForm();

    for (const [fieldName, value] of Object.entries(text)) {
      try {
        form.getTextField(fieldName).setText(value);
      } catch {
        // Field not present on this template version — skip rather than
        // fail the whole render (template revisions may add/remove fields).
      }
    }

    for (const [fieldName, checked] of Object.entries(checkboxes)) {
      try {
        const cb = form.getCheckBox(fieldName);
        if (checked) cb.check();
        else cb.uncheck();
      } catch {
        // as above
      }
    }

    form.flatten();
    const pdfBytes = await pdfDoc.save();

    const storagePath = `sba-forms/159/${dealId}/${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(OUTPUT_BUCKET)
      .upload(storagePath, Buffer.from(pdfBytes), { contentType: "application/pdf", upsert: true });
    if (uploadError) {
      return { ok: false, reason: "fill_failed", detail: uploadError.message };
    }

    return { ok: true, storagePath };
  } catch (err: any) {
    return { ok: false, reason: "fill_failed", detail: err?.message ?? String(err) };
  }
}
