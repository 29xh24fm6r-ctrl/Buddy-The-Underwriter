import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form601BuildResult } from "@/lib/sba/forms/form601/build";
import { FORM_601_TEXT_FIELDS } from "@/lib/sba/forms/form601/pdfFieldMap";
import { normalizeInvertedWidgetRects } from "@/lib/sba/forms/pdfRectFix";

/**
 * SPEC S7 (ARC-00 Phase 5) — fills the official SBA Form 601 PDF using
 * the real AcroForm field names confirmed against a user-supplied copy
 * of the current PDF (docs/sba-forms/601-fields.json — see
 * pdfFieldMap.ts). Deal-level, same shape as form155/render.ts.
 *
 * "Executed the ___ day of ___, 20__" and both "Signature of Authorized
 * Official" fields (native PDFSignature) are left for SignWell, same
 * convention as every other form in this arc.
 */

export type RenderForm601Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "NOT_APPLICABLE" | "TEMPLATE_NOT_AVAILABLE" | "FILL_FAILED"; detail?: string };

export async function renderForm601Pdf(args: { supabase: SupabaseClient; buildResult: Form601BuildResult }): Promise<RenderForm601Result> {
  const { buildResult } = args;
  if (!buildResult.applicable) {
    return { ok: false, reason: "NOT_APPLICABLE" };
  }

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_601")
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
  const setText = (key: keyof typeof FORM_601_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_601_TEXT_FIELDS[key]] = String(value);
  };

  setText("applicant_name_line1", f.applicant_name);
  setText("general_contractor_name", f.general_contractor_name);
  setText("applicant_name_address_phone", f.applicant_name_address_phone);
  setText("applicant_official_name_title", f.applicant_official_name_title);
  setText("subrecipient_name_address_phone", f.subrecipient_name_address_phone);
  setText("contractor_official_name_title", f.contractor_official_name_title);

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
      form.flatten();
    } else {
      const page = pdfDoc.getPage(0);
      const { height } = page.getSize();
      let y = height - 50;
      for (const [key, value] of Object.entries(textValues)) {
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
