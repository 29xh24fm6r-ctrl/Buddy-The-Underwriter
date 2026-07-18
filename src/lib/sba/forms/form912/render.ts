import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { normalizeInvertedWidgetRects } from "@/lib/sba/forms/pdfRectFix";
import type { Form912BuildResult } from "@/lib/sba/forms/form912/build";
import { FORM_912_TEXT_FIELDS, FORM_912_CHECKBOX_FIELDS, FORM_912_RADIO_FIELDS } from "@/lib/sba/forms/form912/pdfFieldMap";
import { decryptStoredPii } from "@/lib/builder/secure/securePiiIntake";

/**
 * SPEC S4 G-2 — fills the official SBA Form 912 PDF (template_key
 * `SBA_912`) using the real AcroForm field names confirmed against a
 * user-supplied copy of the current-revision PDF (docs/sba-forms/912-fields.json
 * — see pdfFieldMap.ts). One PDF per triggering person.
 *
 * Type-aware fill: real 912 has PDFTextField, PDFCheckBox, and
 * PDFRadioGroup fields — the prior version of this file only ever called
 * getTextField(), which would have thrown (and silently skipped) on every
 * checkbox/radio field even with correct names.
 *
 * The full SSN is decrypted here, written into the PDF, and discarded —
 * never logged, never returned, see getDecryptedPii()'s contract.
 */

export type RenderForm912Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "NOT_APPLICABLE" | "TEMPLATE_NOT_AVAILABLE" | "PERSON_NOT_FOUND" | "FILL_FAILED"; detail?: string };

export async function renderForm912Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form912BuildResult;
  ownershipEntityId: string;
  dealId: string;
}): Promise<RenderForm912Result> {
  const { buildResult, dealId } = args;
  if (!buildResult.applicable) {
    return { ok: false, reason: "NOT_APPLICABLE" };
  }

  const person = buildResult.input.persons.find((p) => p.ownership_entity_id === args.ownershipEntityId);
  if (!person) {
    return { ok: false, reason: "PERSON_NOT_FOUND" };
  }

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_912")
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

  const f = person.fields;
  const { data: piiRow } = await args.supabase
    .from("deal_pii_records")
    .select("encrypted_payload")
    .eq("deal_id", dealId)
    .eq("ownership_entity_id", args.ownershipEntityId)
    .eq("pii_type", "full_ssn")
    .maybeSingle();
  const fullSsn = piiRow?.encrypted_payload ? decryptStoredPii(piiRow.encrypted_payload) : null;

  const textValues: Record<string, string> = {};
  const setText = (key: keyof typeof FORM_912_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_912_TEXT_FIELDS[key]] = String(value);
  };

  setText("business_name_address_email", f.business_name_address_email);
  const formerNames = f.all_other_names_used ? ` (formerly: ${f.all_other_names_used})` : "";
  setText("full_name_and_former_names", f.full_name ? `${f.full_name}${formerNames}` : null);
  setText("ownership_percentage", f.ownership_percentage != null ? `${f.ownership_percentage}%` : null);
  setText("full_ssn", fullSsn);
  setText("date_of_birth", f.date_of_birth);
  setText("place_of_birth", f.place_of_birth);
  setText("alien_registration_number", f.alien_registration_number);
  // §7 present/prior residence address intentionally not filled — see the
  // header comment in pdfFieldMap.ts for why (visual fill-test proved the
  // obvious field mapping wrong, and the correct one isn't decipherable
  // without visually confirming the real layout).
  setText("home_phone", f.home_phone);
  setText("business_phone", f.business_phone);
  setText("signer_title", f.signer_title);

  const checkboxValues: Record<string, boolean> = {
    [FORM_912_CHECKBOX_FIELDS.no_alien_registration_number]: !f.alien_registration_number,
  };

  const radioValues: Record<string, string> = {};
  const setRadio = (key: keyof typeof FORM_912_RADIO_FIELDS, boolValue: unknown) => {
    if (boolValue == null) return;
    const map = FORM_912_RADIO_FIELDS[key];
    radioValues[map.fieldName] = boolValue ? map.yesOption : map.noOption;
  };
  setRadio("is_us_citizen", f.is_us_citizen);
  setRadio("incarcerated_or_indicted_financial_crime", f.incarcerated_or_indicted_financial_crime);
  setRadio("riot_related_conviction_past_year", f.riot_related_conviction_past_year);
  setRadio("delinquent_child_support_60days", f.delinquent_child_support_60days);

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
          else checkbox.uncheck();
        } catch {
          // as above
        }
      }
      for (const [fieldName, option] of Object.entries(radioValues)) {
        try {
          form.getRadioGroup(fieldName).select(option);
        } catch {
          // as above
        }
      }
      form.flatten();
    } else {
      const page = pdfDoc.getPage(0);
      const { height } = page.getSize();
      let y = height - 50;
      const overlayValues = { ...textValues, ...Object.fromEntries(Object.entries(checkboxValues).map(([k, v]) => [k, String(v)])), ...radioValues };
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
