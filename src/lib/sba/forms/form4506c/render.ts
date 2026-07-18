import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form4506cBuildResult } from "@/lib/sba/forms/form4506c/build";
import { FORM_4506C_TEXT_FIELDS, FORM_4506C_TAX_PERIOD_FIELDS, FORM_4506C_CHECKBOX_FIELDS } from "@/lib/sba/forms/form4506c/pdfFieldMap";
import { decryptStoredPii } from "@/lib/builder/secure/securePiiIntake";

/**
 * SPEC S4 D-1 — fills the official IRS Form 4506-C PDF using the real
 * AcroForm field names confirmed against a user-supplied copy of the
 * current-revision PDF (docs/sba-forms/4506c-fields.json — see
 * pdfFieldMap.ts). One PDF per signer.
 *
 * Type-aware fill (text/checkbox), matching form912/render.ts's pattern.
 * The full taxpayer SSN is decrypted here, written into the PDF, and
 * discarded — never logged, never returned.
 *
 * IVES participant fields (§5a) read from banks.settings (per-bank),
 * falling back to env vars — see the bankId-gated block below.
 */

export type RenderForm4506cResult =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "TEMPLATE_NOT_AVAILABLE" | "SIGNER_NOT_FOUND" | "FILL_FAILED"; detail?: string };

export async function renderForm4506cPdf(args: {
  supabase: SupabaseClient;
  buildResult: Form4506cBuildResult;
  ownershipEntityId: string;
  dealId: string;
  bankId?: string;
}): Promise<RenderForm4506cResult> {
  const signer = args.buildResult.input.signers.find((s) => s.ownership_entity_id === args.ownershipEntityId);
  if (!signer) {
    return { ok: false, reason: "SIGNER_NOT_FOUND" };
  }
  const thirdParty = args.buildResult.input.thirdParty;

  // IVES participant (§5a) — per-bank config (banks.settings jsonb, same
  // pattern as src/lib/etran/generator.ts's sba_lender_id/sba_service_center),
  // falling back to env vars for a single-tenant/dev setup. Actual IVES
  // enrollment with the IRS is a separate operational step this codebase
  // can't provision — left blank if neither source has a value, never
  // fabricated.
  let bankSettings: Record<string, unknown> = {};
  if (args.bankId) {
    const { data: bank } = await args.supabase.from("banks").select("settings").eq("id", args.bankId).maybeSingle();
    bankSettings = (bank as { settings?: Record<string, unknown> } | null)?.settings ?? {};
  }
  const ivesParticipantName = (bankSettings.ives_participant_name as string | undefined) ?? process.env.IVES_PARTICIPANT_NAME ?? null;
  const ivesParticipantId = (bankSettings.ives_participant_id as string | undefined) ?? process.env.IVES_PARTICIPANT_ID ?? null;
  const ivesSorMailboxId = (bankSettings.ives_sor_mailbox_id as string | undefined) ?? process.env.IVES_SOR_MAILBOX_ID ?? null;

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "IRS_4506C")
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

  const f = { ...signer.fields, ...thirdParty };
  const textValues: Record<string, string> = {};
  const setText = (key: keyof typeof FORM_4506C_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_4506C_TEXT_FIELDS[key]] = String(value);
  };

  setText("taxpayer_first_name", f.taxpayer_first_name);
  setText("taxpayer_middle_initial", f.taxpayer_middle_initial);
  setText("taxpayer_last_name", f.taxpayer_last_name);
  setText("taxpayer_id", fullSsn);
  setText("previous_first_name", f.previous_first_name);
  setText("previous_last_name", f.previous_last_name);
  setText("spouse_first_name", f.spouse_first_name);
  setText("spouse_last_name", f.spouse_last_name);
  // Spouse full SSN isn't collected anywhere in this schema yet — see
  // inputBuilder.ts. Left unfilled rather than sending a masked/partial
  // value on a legal document.
  setText("current_address_street", f.current_address_street);
  setText("current_address_city", f.current_address_city);
  setText("current_address_state", f.current_address_state);
  setText("current_address_zip", f.current_address_zip);
  setText("previous_address_street", f.previous_address_street);
  setText("previous_address_city", f.previous_address_city);
  setText("previous_address_state", f.previous_address_state);
  setText("previous_address_zip", f.previous_address_zip);
  setText("ives_participant_name", ivesParticipantName);
  setText("ives_participant_id", ivesParticipantId);
  setText("ives_sor_mailbox_id", ivesSorMailboxId);
  setText("customer_file_number", f.customer_file_number);
  setText("client_name", f.client_name);
  setText("client_phone", f.client_phone);
  setText("client_street", f.client_address);
  setText("tax_form_number_line6", f.tax_form_number_line6);
  const wageIncomeFormNumbers = Array.isArray(f.wage_income_form_numbers) ? (f.wage_income_form_numbers as unknown[]) : [];
  setText("wage_income_form_number_1", wageIncomeFormNumbers[0]);
  setText("wage_income_form_number_2", wageIncomeFormNumbers[1]);
  setText("wage_income_form_number_3", wageIncomeFormNumbers[2]);
  setText("signer_print_name", f.signer_print_name);
  setText("signer_title", f.signer_title);
  setText("signer_phone", f.signer_phone);

  // §8 — up to 4 tax periods, each "MM/DD/YYYY" split into 3 sub-fields.
  const taxPeriods = Array.isArray(f.tax_periods) ? (f.tax_periods as unknown[]) : [];
  taxPeriods.slice(0, 4).forEach((period, i) => {
    if (typeof period !== "string") return;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(period);
    if (!match) return;
    const slot = FORM_4506C_TAX_PERIOD_FIELDS[i];
    textValues[slot.month] = match[1];
    textValues[slot.day] = match[2];
    textValues[slot.year] = match[3];
  });

  const checkboxValues: Record<string, boolean> = {};
  const setCheckbox = (key: keyof typeof FORM_4506C_CHECKBOX_FIELDS, value: unknown) => {
    if (value == null) return;
    checkboxValues[FORM_4506C_CHECKBOX_FIELDS[key]] = Boolean(value);
  };
  setCheckbox("transcript_type_return", f.transcript_type_return);
  setCheckbox("transcript_type_account", f.transcript_type_account);
  setCheckbox("transcript_type_record_of_account", f.transcript_type_record_of_account);
  setCheckbox("wants_wage_income_transcript", f.wants_wage_income_transcript);

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
