import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form155BuildResult } from "@/lib/sba/forms/form155/build";
import { FORM_155_TEXT_FIELDS, FORM_155_RADIO_FIELDS } from "@/lib/sba/forms/form155/pdfFieldMap";

/**
 * SPEC S4 G-3 — fills the official SBA Form 155 PDF using the real
 * AcroForm field names confirmed against a user-supplied copy of the
 * current (9/98) revision (docs/sba-forms/155-fields.json — see
 * pdfFieldMap.ts), verified by visually rendering a fill-test. Deal-level,
 * not per-signer (unlike 4506-C/912) — Form 155 has exactly one instance
 * per deal when applicable. Same fill-or-overlay / never-fabricate
 * contract as the rest of this arc's renderers.
 *
 * The "Dated:"/signature-line fields are intentionally left unfilled —
 * SignWell fills those at signing, same convention as every other form
 * in this arc.
 */

export type RenderForm155Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "NOT_APPLICABLE" | "TEMPLATE_NOT_AVAILABLE" | "FILL_FAILED"; detail?: string };

export async function renderForm155Pdf(args: { supabase: SupabaseClient; buildResult: Form155BuildResult }): Promise<RenderForm155Result> {
  const { buildResult } = args;
  if (!buildResult.applicable) {
    return { ok: false, reason: "NOT_APPLICABLE" };
  }

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_155")
    .eq("is_active", true)
    .maybeSingle();

  if (!template?.file_path) {
    return { ok: false, reason: "TEMPLATE_NOT_AVAILABLE" };
  }

  let templateBytes: Buffer;
  try {
    templateBytes = await readFile(path.join(process.cwd(), "public", template.file_path));
  } catch (err: any) {
    return { ok: false, reason: "TEMPLATE_NOT_AVAILABLE", detail: err?.message ?? String(err) };
  }

  const f = buildResult.input;
  const textValues: Record<string, string> = {};
  const setText = (key: keyof typeof FORM_155_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_155_TEXT_FIELDS[key]] = String(value);
  };

  setText("sba_loan_number", f.sba_loan_number);
  setText("sba_loan_name", f.sba_loan_name);
  setText("standby_creditor_name", f.standby_creditor_name);
  setText("standby_borrower_name", f.standby_borrower_name);
  setText("lender_name", f.lender_name);
  setText("note_principal_amount", f.note_principal_amount);
  setText("note_interest_amount", f.note_interest_amount);
  setText("lenders_loan_amount", f.lenders_loan_amount);
  setText("print_name", f.print_name);

  const agreeOption = f.agree_option != null ? String(f.agree_option) : null;
  if (agreeOption === "2") setText("agree_option_2_rate", f.agree_option_2_rate);
  if (agreeOption === "3") setText("agree_option_3_rate", f.agree_option_3_rate);
  if (agreeOption === "4") {
    setText("agree_option_4_rate", f.agree_option_4_rate);
    setText("agree_option_4_start_date", f.agree_option_4_start_date);
  }

  try {
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    if (fields.length > 0) {
      for (const [fieldName, value] of Object.entries(textValues)) {
        try {
          form.getTextField(fieldName).setText(value);
        } catch {
          // Real field genuinely not present on this template version —
          // skip rather than fail the whole render.
        }
      }
      if (agreeOption && FORM_155_RADIO_FIELDS.agree_option.options.includes(agreeOption as never)) {
        try {
          form.getRadioGroup(FORM_155_RADIO_FIELDS.agree_option.fieldName).select(agreeOption);
        } catch {
          // as above
        }
      }
      form.flatten();
    } else {
      const page = pdfDoc.getPage(0);
      const { height } = page.getSize();
      let y = height - 50;
      const overlayValues = { ...textValues, ...(agreeOption ? { Agree: agreeOption } : {}) };
      for (const [key, value] of Object.entries(overlayValues)) {
        if (y < 40) break;
        page.drawText(`${key}: ${value}`, { x: 40, y, size: 8 });
        y -= 12;
      }
    }

    const pdfBytes = await pdfDoc.save();
    return { ok: true, pdfBytes: Buffer.from(pdfBytes) };
  } catch (err: any) {
    return { ok: false, reason: "FILL_FAILED", detail: err?.message ?? String(err) };
  }
}
