import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { normalizeInvertedWidgetRects } from "@/lib/sba/forms/pdfRectFix";
import type { Form1919BuildResult } from "@/lib/sba/forms/form1919/build";
import {
  FORM_1919_SECTION_I_TEXT_FIELDS,
  FORM_1919_SECTION_I_CHECKBOX_FIELDS,
  FORM_1919_SECTION_II_TEXT_FIELDS,
  FORM_1919_VETERAN_CHECKBOX_FIELDS,
  FORM_1919_SEX_CHECKBOX_FIELDS,
  FORM_1919_RACE_CHECKBOX_FIELDS,
  FORM_1919_ETHNICITY_CHECKBOX_FIELDS,
  FORM_1919_YES_NO_QUESTIONS,
  FORM_1919_ROSTER_FIELDS,
  FORM_1919_SIGNATURE_TEXT_FIELDS,
} from "@/lib/sba/forms/form1919/pdfFieldMap";
import { decryptStoredPii } from "@/lib/builder/secure/securePiiIntake";

/**
 * SPEC S2 D-4 — fills the official SBA Form 1919 PDF using the real
 * AcroForm field names confirmed against a user-supplied copy of the
 * current-revision PDF (docs/sba-forms/1919-fields.json — see
 * pdfFieldMap.ts).
 *
 * IMPORTANT — architecture fix, not just field names: Section II
 * (demographics, veteran status, all 13 compliance questions,
 * export-sales) is completed PER COVERED INDIVIDUAL on the real form,
 * confirmed by its page position sitting alongside a single per-person
 * "ownName" field distinct from Section I's 5-slot roster. The prior
 * version of this file rendered one shared PDF per deal with no way to
 * select whose Section II answers to use. This now takes
 * `ownershipEntityId` and renders ONE PDF for THAT individual — Section
 * I (business info) and the roster are identical across every
 * individual's copy; Section II is specific to them.
 *
 * Type-aware fill: text fields, single checkboxes, demographic
 * "choose-one-of-N" checkbox groups, and the 13 yes/no questions (each a
 * Yes/No CheckBox *pair*, not a RadioGroup — checking one doesn't
 * uncheck the other, so both must be set explicitly).
 *
 * Full SSNs (the rendered individual's own, and each roster owner's) are
 * decrypted here, written into the PDF, and discarded — never logged,
 * never returned.
 */

export type RenderForm1919Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "TEMPLATE_NOT_AVAILABLE" | "PERSON_NOT_FOUND" | "FILL_FAILED"; detail?: string };

function combineAddress(street: unknown, city: unknown, state: unknown, zip: unknown): string | null {
  const parts = [street, [city, state].filter(Boolean).join(", "), zip].filter((p) => p != null && p !== "");
  return parts.length > 0 ? parts.join(", ") : null;
}

async function decryptFullSsn(supabase: SupabaseClient, dealId: string, ownershipEntityId: string): Promise<string | null> {
  const { data } = await supabase
    .from("deal_pii_records")
    .select("encrypted_payload")
    .eq("deal_id", dealId)
    .eq("ownership_entity_id", ownershipEntityId)
    .eq("pii_type", "full_ssn")
    .maybeSingle();
  return data?.encrypted_payload ? decryptStoredPii(data.encrypted_payload) : null;
}

export async function renderForm1919Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form1919BuildResult;
  ownershipEntityId: string;
  dealId: string;
}): Promise<RenderForm1919Result> {
  const { buildResult, dealId, supabase } = args;
  const person = buildResult.input.sectionII.find((p) => p.ownership_entity_id === args.ownershipEntityId);
  if (!person) {
    return { ok: false, reason: "PERSON_NOT_FOUND" };
  }

  const { data: template } = await supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_1919")
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

  const s1 = buildResult.input.sectionI;
  const s2 = person.fields;

  const textValues: Record<string, string> = {};
  const setText1 = (key: keyof typeof FORM_1919_SECTION_I_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_1919_SECTION_I_TEXT_FIELDS[key]] = String(value);
  };
  const setText2 = (key: keyof typeof FORM_1919_SECTION_II_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_1919_SECTION_II_TEXT_FIELDS[key]] = String(value);
  };

  // --- Section I ---
  setText1("applicant_legal_name", s1.applicant_legal_name);
  setText1("applicant_dba", s1.applicant_dba);
  setText1("applicant_ein", s1.applicant_ein);
  setText1("applicant_naics", s1.applicant_naics);
  setText1("applicant_phone", s1.applicant_phone);
  setText1("unique_entity_id", s1.unique_entity_id);
  setText1("applicant_year_founded", s1.applicant_year_founded);
  setText1("special_ownership_type_other", s1.special_ownership_type_other);
  setText1("applicant_address", combineAddress(s1.applicant_address_street, s1.applicant_address_city, s1.applicant_address_state, s1.applicant_address_zip));
  setText1("project_address", combineAddress(s1.project_address_street, s1.project_address_city, s1.project_address_state, s1.project_address_zip));
  setText1("poc_name", s1.poc_name);
  setText1("poc_email", s1.poc_email);
  setText1("existing_employees", s1.applicant_employee_count);
  setText1("jobs_retained", s1.jobs_retained);
  setText1("jobs_created", s1.jobs_created);
  // Loan-purpose amount breakdown routes through the generic "Other"
  // slot — see the comment in inputBuilder.ts on why it isn't split into
  // the form's more specific purpose categories yet.
  if (s1.use_of_proceeds_summary || s1.loan_amount != null) {
    setText1("other_purpose_1_description", s1.use_of_proceeds_summary ?? s1.loan_program);
    setText1("other_purpose_1_amount", s1.loan_amount);
  }

  const checkboxValues: Record<string, boolean> = {};
  const businessType = String(s1.applicant_business_type ?? "").toLowerCase();
  const ENTITY_TYPE_CHECKBOX: Record<string, string> = {
    sole_proprietorship: FORM_1919_SECTION_I_CHECKBOX_FIELDS.entity_type_sole_prop,
    sole_prop: FORM_1919_SECTION_I_CHECKBOX_FIELDS.entity_type_sole_prop,
    partnership: FORM_1919_SECTION_I_CHECKBOX_FIELDS.entity_type_partnership,
    c_corp: FORM_1919_SECTION_I_CHECKBOX_FIELDS.entity_type_c_corp,
    corporation: FORM_1919_SECTION_I_CHECKBOX_FIELDS.entity_type_c_corp,
    s_corp: FORM_1919_SECTION_I_CHECKBOX_FIELDS.entity_type_s_corp,
    llc: FORM_1919_SECTION_I_CHECKBOX_FIELDS.entity_type_llc,
  };
  const entityTypeField = ENTITY_TYPE_CHECKBOX[businessType];
  if (entityTypeField) {
    checkboxValues[entityTypeField] = true;
  } else if (businessType) {
    checkboxValues[FORM_1919_SECTION_I_CHECKBOX_FIELDS.entity_type_other] = true;
  }
  if (s1.special_ownership_type) {
    const SPECIAL_OWNERSHIP_CHECKBOX: Record<string, string> = {
      esop: FORM_1919_SECTION_I_CHECKBOX_FIELDS.special_ownership_esop,
      "401k_or_robs": FORM_1919_SECTION_I_CHECKBOX_FIELDS.special_ownership_401k,
      cooperative: FORM_1919_SECTION_I_CHECKBOX_FIELDS.special_ownership_cooperative,
      native_american_tribal: FORM_1919_SECTION_I_CHECKBOX_FIELDS.special_ownership_tribal,
      other: FORM_1919_SECTION_I_CHECKBOX_FIELDS.special_ownership_other,
    };
    const field = SPECIAL_OWNERSHIP_CHECKBOX[String(s1.special_ownership_type)];
    if (field) checkboxValues[field] = true;
  }
  if (s1.use_of_proceeds_summary || s1.loan_amount != null) {
    checkboxValues[FORM_1919_SECTION_I_CHECKBOX_FIELDS.purpose_other_1] = true;
  }

  // --- Section II (this individual only) ---
  setText2("full_name", s2.full_name);
  setText2("position", s2.position);
  setText2("export_sales_total", s2.export_sales_total);
  setText2("export_country_1", s2.export_country_1);
  setText2("export_country_2", s2.export_country_2);
  setText2("export_country_3", s2.export_country_3);
  const fullSsn = await decryptFullSsn(supabase, dealId, args.ownershipEntityId);
  // No dedicated SSN field exists in Section II on this revision (unlike
  // 912/413) — the individual's TIN is captured on Section I's roster
  // instead (ownTin1-5), filled below.

  if (s2.veteran_status && FORM_1919_VETERAN_CHECKBOX_FIELDS[String(s2.veteran_status)]) {
    checkboxValues[FORM_1919_VETERAN_CHECKBOX_FIELDS[String(s2.veteran_status)]] = true;
  }
  if (s2.sex && FORM_1919_SEX_CHECKBOX_FIELDS[String(s2.sex)]) {
    checkboxValues[FORM_1919_SEX_CHECKBOX_FIELDS[String(s2.sex)]] = true;
  }
  if (s2.race && FORM_1919_RACE_CHECKBOX_FIELDS[String(s2.race)]) {
    checkboxValues[FORM_1919_RACE_CHECKBOX_FIELDS[String(s2.race)]] = true;
  }
  if (s2.ethnicity && FORM_1919_ETHNICITY_CHECKBOX_FIELDS[String(s2.ethnicity)]) {
    checkboxValues[FORM_1919_ETHNICITY_CHECKBOX_FIELDS[String(s2.ethnicity)]] = true;
  }

  for (const [key, pair] of Object.entries(FORM_1919_YES_NO_QUESTIONS)) {
    const value = s2[key];
    if (value == null) continue;
    checkboxValues[pair.yes] = value === true;
    checkboxValues[pair.no] = value === false;
  }

  // --- Section I roster (up to 5 owners, identical on every copy) ---
  for (let i = 0; i < buildResult.input.ownerRoster.length && i < FORM_1919_ROSTER_FIELDS.length; i++) {
    const owner = buildResult.input.ownerRoster[i];
    const slot = FORM_1919_ROSTER_FIELDS[i];
    if (owner.name) textValues[slot.name] = owner.name;
    if (owner.title) textValues[slot.title] = owner.title;
    if (owner.percentage != null) textValues[slot.percentage] = `${owner.percentage}%`;
    if (owner.home_address) textValues[slot.homeAddress] = owner.home_address;
    const tin = owner.is_individual
      ? owner.ownership_entity_id === args.ownershipEntityId
        ? fullSsn
        : await decryptFullSsn(supabase, dealId, owner.ownership_entity_id)
      : owner.entity_ein;
    if (tin) textValues[slot.tin] = tin;
  }

  // --- Signature block (this individual signs their own copy) ---
  if (s2.full_name) textValues[FORM_1919_SIGNATURE_TEXT_FIELDS.rep_name] = String(s2.full_name);
  if (s2.position) textValues[FORM_1919_SIGNATURE_TEXT_FIELDS.rep_title] = String(s2.position);

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
