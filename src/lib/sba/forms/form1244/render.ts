import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form1244BuildResult } from "@/lib/sba/forms/form1244/build";
import {
  FORM_1244_SECTION_I_TEXT_FIELDS,
  FORM_1244_SECTION_I_CHECKBOX_FIELDS,
  FORM_1244_APPLICANT_OWNER_ROSTER_FIELDS,
  FORM_1244_OC_OWNER_ROSTER_FIELDS,
  FORM_1244_SECTION_II_TEXT_FIELDS,
  FORM_1244_SECTION_II_CHECKBOX_FIELDS,
  FORM_1244_SECTION_III_TEXT_FIELDS,
} from "@/lib/sba/forms/form1244/pdfFieldMap";
import { normalizeInvertedWidgetRects } from "@/lib/sba/forms/pdfRectFix";
import { decryptStoredPii } from "@/lib/builder/secure/securePiiIntake";

/** Every phone field on this form is labeled "(xxx-xxx-xxxx)" but is a raw 10-digit field with no room for punctuation (confirmed: maxLength=10). */
function digitsOnly(value: unknown): string | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits ? digits.slice(0, 10) : null;
}

/**
 * SPEC S6 (ARC-00 Phase 4) — fills the official SBA Form 1244 PDF using
 * the real AcroForm field names confirmed against a user-supplied copy
 * of the current (12/2021) PDF (docs/sba-forms/1244-fields.json — see
 * pdfFieldMap.ts). Section Two is per-Associate on the real form (this
 * template has one instance; extra associates need attached copies per
 * the form's own page-11 signature-page instructions), so — same
 * architecture as form1919/render.ts — this renders one PDF per
 * individual, carrying Sections One/Owner-Roster/Three (all deal-level)
 * along with that one person's Section Two answers.
 *
 * Section Four ("Completed by the CDC") is not filled here at all — it's
 * the CDC's own back-office paperwork, out of this form module's scope.
 */

export type RenderForm1244Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "SIGNER_NOT_FOUND" | "TEMPLATE_NOT_AVAILABLE" | "FILL_FAILED"; detail?: string };

export async function renderForm1244Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form1244BuildResult;
  ownershipEntityId: string;
  dealId: string;
}): Promise<RenderForm1244Result> {
  const person = args.buildResult.input.sectionII.find((p) => p.ownership_entity_id === args.ownershipEntityId);
  if (!person) {
    return { ok: false, reason: "SIGNER_NOT_FOUND" };
  }

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_1244")
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

  const { data: piiRow } = await args.supabase
    .from("deal_pii_records")
    .select("encrypted_payload")
    .eq("deal_id", args.dealId)
    .eq("ownership_entity_id", args.ownershipEntityId)
    .eq("pii_type", "full_ssn")
    .maybeSingle();
  const fullSsn = piiRow?.encrypted_payload ? decryptStoredPii(piiRow.encrypted_payload) : null;

  const textValues: Record<string, string> = {};
  const checkboxValues: Record<string, boolean> = {};

  // Section One
  const s1 = args.buildResult.input.sectionI;
  const setSectionIText = (key: keyof typeof FORM_1244_SECTION_I_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_1244_SECTION_I_TEXT_FIELDS[key]] = String(value);
  };
  for (const key of Object.keys(FORM_1244_SECTION_I_TEXT_FIELDS) as Array<keyof typeof FORM_1244_SECTION_I_TEXT_FIELDS>) {
    setSectionIText(key, key === "applicant_phone" || key === "oc_phone" ? digitsOnly(s1[key]) : s1[key]);
  }
  const setSectionICheckbox = (key: keyof typeof FORM_1244_SECTION_I_CHECKBOX_FIELDS, value: boolean) => {
    checkboxValues[FORM_1244_SECTION_I_CHECKBOX_FIELDS[key]] = value;
  };
  if (s1.has_affiliates != null) {
    setSectionICheckbox("has_affiliates_yes", s1.has_affiliates === true);
    setSectionICheckbox("has_affiliates_no", s1.has_affiliates === false);
  }
  if (s1.obtained_direct_or_guaranteed_loan != null) {
    setSectionICheckbox("obtained_direct_or_guaranteed_loan_yes", s1.obtained_direct_or_guaranteed_loan === true);
    setSectionICheckbox("obtained_direct_or_guaranteed_loan_no", s1.obtained_direct_or_guaranteed_loan === false);
  }
  if (s1.prior_application_submitted != null) {
    setSectionICheckbox("prior_application_submitted_yes", s1.prior_application_submitted === true);
    setSectionICheckbox("prior_application_submitted_no", s1.prior_application_submitted === false);
  }
  if (s1.ever_bankrupt != null) {
    setSectionICheckbox("ever_bankrupt_yes", s1.ever_bankrupt === true);
    setSectionICheckbox("ever_bankrupt_no", s1.ever_bankrupt === false);
  }
  if (s1.pending_lawsuits != null) {
    setSectionICheckbox("pending_lawsuits_yes", s1.pending_lawsuits === true);
    setSectionICheckbox("pending_lawsuits_no", s1.pending_lawsuits === false);
  }

  // Owner/Ownership roster — up to 10 rows per entity.
  args.buildResult.input.applicantOwnerRoster.slice(0, 10).forEach((row, i) => {
    const slot = FORM_1244_APPLICANT_OWNER_ROSTER_FIELDS[i];
    if (row.name != null) textValues[slot.name] = String(row.name);
    if (row.title != null) textValues[slot.title] = String(row.title);
    if (row.ssn_tin_on_file) textValues[slot.ssnTin] = "On file";
    if (row.ownership_pct != null) textValues[slot.ownershipPct] = String(row.ownership_pct);
  });
  args.buildResult.input.ocOwnerRoster.slice(0, 10).forEach((row, i) => {
    const slot = FORM_1244_OC_OWNER_ROSTER_FIELDS[i];
    if (row.name != null) textValues[slot.name] = String(row.name);
    if (row.title != null) textValues[slot.title] = String(row.title);
    if (row.ssn_tin_on_file) textValues[slot.ssnTin] = "On file";
    if (row.ownership_pct != null) textValues[slot.ownershipPct] = String(row.ownership_pct);
  });

  // Section Two — this individual's own answers.
  const f = person.fields;
  const setSectionIIText = (key: keyof typeof FORM_1244_SECTION_II_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_1244_SECTION_II_TEXT_FIELDS[key]] = String(value);
  };
  setSectionIIText("full_name", f.full_name);
  setSectionIIText("former_names_and_dates_used", f.former_names_and_dates_used);
  setSectionIIText("country_of_citizenship", f.country_of_citizenship);
  setSectionIIText("place_of_birth", f.place_of_birth);
  setSectionIIText("date_of_birth", f.date_of_birth);
  setSectionIIText("phone", digitsOnly(f.phone));
  setSectionIIText("home_address", f.home_address);
  setSectionIIText("sba_loan_entity_interest_details", f.sba_loan_entity_interest_details);
  setSectionIIText("ssn_or_tin", fullSsn);

  const setSectionIICheckbox = (key: keyof typeof FORM_1244_SECTION_II_CHECKBOX_FIELDS, value: boolean) => {
    checkboxValues[FORM_1244_SECTION_II_CHECKBOX_FIELDS[key]] = value;
  };
  if (f.is_us_citizen != null) {
    setSectionIICheckbox("is_us_citizen_yes", f.is_us_citizen === true);
    setSectionIICheckbox("is_us_citizen_no", f.is_us_citizen === false);
  }
  if (f.sba_loan_entity_interest != null) {
    setSectionIICheckbox("sba_loan_entity_interest_yes", f.sba_loan_entity_interest === true);
    setSectionIICheckbox("sba_loan_entity_interest_no", f.sba_loan_entity_interest === false);
  }
  if (f.subject_to_indictment != null) {
    setSectionIICheckbox("subject_to_indictment_yes", f.subject_to_indictment === true);
    setSectionIICheckbox("subject_to_indictment_no", f.subject_to_indictment === false);
  }
  if (f.arrested_6mo != null) {
    setSectionIICheckbox("arrested_6mo_yes", f.arrested_6mo === true);
    setSectionIICheckbox("arrested_6mo_no", f.arrested_6mo === false);
  }
  if (f.convicted_diversion_or_parole != null) {
    setSectionIICheckbox("convicted_diversion_parole_yes", f.convicted_diversion_or_parole === true);
    setSectionIICheckbox("convicted_diversion_parole_no", f.convicted_diversion_or_parole === false);
  }
  if (f.suspended_debarred_ineligible != null) {
    setSectionIICheckbox("suspended_debarred_yes", f.suspended_debarred_ineligible === true);
    setSectionIICheckbox("suspended_debarred_no", f.suspended_debarred_ineligible === false);
  }

  // Section Three — signature/certification block. Only the printed
  // identity fields are filled; actual signatures/dates/attestation are
  // left for SignWell, same convention as every other form in this arc.
  const setSectionIIIText = (key: keyof typeof FORM_1244_SECTION_III_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_1244_SECTION_III_TEXT_FIELDS[key]] = String(value);
  };
  setSectionIIIText("applicant_legal_name_sig", s1.applicant_legal_name);
  setSectionIIIText("applicant_dba_sig", s1.applicant_dba);
  setSectionIIIText("applicant_epc_or_oc", args.buildResult.input.isEligiblePassiveCompany ? "EPC" : "N/A");
  if (args.buildResult.input.isEligiblePassiveCompany) {
    setSectionIIIText("oc_legal_name_sig", s1.oc_legal_name);
    setSectionIIIText("oc_dba_sig", s1.oc_dba);
    setSectionIIIText("oc_epc_or_oc", "OC");
  }
  setSectionIIIText("associate_print_name", f.full_name);

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
