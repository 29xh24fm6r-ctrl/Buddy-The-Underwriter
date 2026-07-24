import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { normalizeInvertedWidgetRects } from "@/lib/sba/forms/pdfRectFix";
import type { Form148BuildResult } from "@/lib/sba/forms/form148/build";
import { FORM_148_TEXT_FIELDS, FORM_148L_TEXT_FIELDS, FORM_148L_CHECKBOX_FIELDS, GUARANTEE_LIMITATION_CHECKBOX } from "@/lib/sba/forms/form148/pdfFieldMap";
import { amountToWords } from "@/lib/sba/forms/numberToWords";

/**
 * SPEC S7 (ARC-00 Phase 5) — fills the official SBA Form 148
 * (`template_key: "SBA_148"`) or 148L (`"SBA_148L"`) PDF depending on the
 * signer's guaranteeType, using the real AcroForm field names confirmed
 * against user-supplied copies of both current PDFs (see
 * pdfFieldMap.ts). Same fill-or-overlay / never-fabricate contract as
 * every other renderer in this arc.
 *
 * Neither form's signature block/date is ever pre-filled (148's
 * "SignatureBlock" is a single combined name+signature box; 148L's
 * guarantorSignature1-10 are native PDFSignature fields, not plain text
 * — both left entirely to SignWell).
 */

export type RenderForm148Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "SIGNER_NOT_FOUND" | "TEMPLATE_NOT_AVAILABLE" | "FILL_FAILED"; detail?: string };

export async function renderForm148Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form148BuildResult;
  ownershipEntityId: string;
}): Promise<RenderForm148Result> {
  const signer = args.buildResult.input.signers.find((s) => s.ownership_entity_id === args.ownershipEntityId);
  if (!signer) {
    return { ok: false, reason: "SIGNER_NOT_FOUND" };
  }

  const templateKey = signer.guaranteeType === "limited" ? "SBA_148L" : "SBA_148";

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", templateKey)
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

  const f = signer.fields;
  const textValues: Record<string, string> = {};
  const checkboxValues: Record<string, boolean> = {};

  if (signer.guaranteeType === "limited") {
    const setText = (key: keyof typeof FORM_148L_TEXT_FIELDS, value: unknown) => {
      if (value == null || value === "") return;
      textValues[FORM_148L_TEXT_FIELDS[key]] = String(value);
    };
    setText("sba_loan_number", f.sba_loan_number);
    setText("sba_loan_name", f.sba_loan_name);
    setText("guarantor_name", f.guarantor_name);
    setText("guarantor_name_1", f.guarantor_name);
    setText("borrower_legal_name", f.borrower_legal_name);
    setText("lender_name", f.lender_name);
    setText("loan_amount", f.loan_amount);
    setText("note_date", f.note_date);
    if (typeof f.loan_amount === "number") setText("loan_amount_words", amountToWords(f.loan_amount));

    const limitationType = f.guarantee_limitation_type != null ? String(f.guarantee_limitation_type) : null;
    if (limitationType && GUARANTEE_LIMITATION_CHECKBOX[limitationType]) {
      checkboxValues[FORM_148L_CHECKBOX_FIELDS[GUARANTEE_LIMITATION_CHECKBOX[limitationType]]] = true;
    }
    if (limitationType === "balance_reduction") setText("limit_balance_under", f.limit_balance_under);
    if (limitationType === "principal_reduction") setText("limit_principal_under", f.limit_principal_under);
    if (limitationType === "max_liability") setText("limit_max_payment", f.limit_max_payment);
    if (limitationType === "percentage") setText("limit_percent_payment", f.limit_percent_payment);
    if (limitationType === "time_based") setText("limit_time_years", f.limit_time_years);
    if (limitationType === "collateral") setText("limit_collateral_description", f.limit_collateral_description);
  } else {
    const setText = (key: keyof typeof FORM_148_TEXT_FIELDS, value: unknown) => {
      if (value == null || value === "") return;
      textValues[FORM_148_TEXT_FIELDS[key]] = String(value);
    };
    setText("sba_loan_number", f.sba_loan_number);
    setText("sba_loan_name", f.sba_loan_name);
    setText("guarantor_name", f.guarantor_name);
    setText("borrower_legal_name", f.borrower_legal_name);
    setText("lender_name", f.lender_name);
    setText("loan_amount", f.loan_amount);
    setText("agreement_date", f.agreement_date);
    setText("note_date", f.note_date);
    if (typeof f.loan_amount === "number") setText("loan_amount_words", amountToWords(f.loan_amount));
  }

  try {
    const pdfDoc = await PDFDocument.load(templateBytes);
    normalizeInvertedWidgetRects(pdfDoc);
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
      for (const [fieldName, checked] of Object.entries(checkboxValues)) {
        try {
          const checkbox = form.getCheckBox(fieldName);
          if (checked) checkbox.check();
        } catch {
          // as above
        }
      }
      form.flatten();
    } else {
      const page = pdfDoc.getPage(0);
      const { height } = page.getSize();
      let y = height - 50;
      const overlayValues = { ...textValues, ...Object.fromEntries(Object.entries(checkboxValues).map(([k, v]) => [k, String(v)])) };
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
