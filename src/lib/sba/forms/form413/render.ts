import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { normalizeInvertedWidgetRects } from "@/lib/sba/forms/pdfRectFix";
import type { Form413BuildResult } from "@/lib/sba/forms/form413/build";
import {
  FORM_413_TEXT_FIELDS,
  FORM_413_CHECKBOX_FIELDS,
  FORM_413_NOTES_PAYABLE_FIELDS,
  FORM_413_SECURITIES_FIELDS,
  FORM_413_REAL_ESTATE_FIELDS,
} from "@/lib/sba/forms/form413/pdfFieldMap";
import { decryptStoredPii } from "@/lib/builder/secure/securePiiIntake";

/**
 * SPEC S2 E — fills the official SBA Form 413 PDF using the real
 * AcroForm field names confirmed against a user-supplied copy of the
 * current-revision PDF (docs/sba-forms/413-fields.json — see
 * pdfFieldMap.ts). One rendered PDF per signer.
 *
 * The full SSN (this signer's own, and their spouse's if has_spouse is
 * true) is decrypted here, written into the PDF, and discarded — never
 * logged, never returned.
 */

export type RenderForm413Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "TEMPLATE_NOT_AVAILABLE" | "SIGNER_NOT_FOUND" | "FILL_FAILED"; detail?: string };

function combineCityStateZip(city: unknown, state: unknown, zip: unknown): string | null {
  const parts = [[city, state].filter(Boolean).join(", "), zip].filter((p) => p != null && p !== "");
  return parts.length > 0 ? parts.join(" ") : null;
}

const BUSINESS_TYPE_CHECKBOX: Record<string, keyof typeof FORM_413_CHECKBOX_FIELDS> = {
  corporation: "business_type_corporation",
  c_corp: "business_type_corporation",
  s_corp: "business_type_s_corp",
  llc: "business_type_llc",
  partnership: "business_type_partnership",
  sole_proprietorship: "business_type_sole_prop",
  sole_prop: "business_type_sole_prop",
};

export async function renderForm413Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form413BuildResult;
  ownershipEntityId: string;
  dealId: string;
}): Promise<RenderForm413Result> {
  const signer = args.buildResult.input.signers.find((s) => s.ownership_entity_id === args.ownershipEntityId);
  if (!signer) {
    return { ok: false, reason: "SIGNER_NOT_FOUND" };
  }

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_413")
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
  const { data: piiRows } = await args.supabase
    .from("deal_pii_records")
    .select("pii_type, encrypted_payload")
    .eq("deal_id", args.dealId)
    .eq("ownership_entity_id", args.ownershipEntityId)
    .in("pii_type", ["full_ssn", "spouse_full_ssn"]);
  const piiByType = new Map(
    ((piiRows ?? []) as Array<{ pii_type: string; encrypted_payload: string }>).map((r) => [r.pii_type, r.encrypted_payload]),
  );
  const fullSsn = piiByType.has("full_ssn") ? decryptStoredPii(piiByType.get("full_ssn")!) : null;
  const spouseFullSsn = piiByType.has("spouse_full_ssn") ? decryptStoredPii(piiByType.get("spouse_full_ssn")!) : null;

  const textValues: Record<string, string> = {};
  const setText = (key: keyof typeof FORM_413_TEXT_FIELDS, value: unknown) => {
    if (value == null || value === "") return;
    textValues[FORM_413_TEXT_FIELDS[key]] = String(value);
  };

  setText("full_name", f.full_name);
  setText("business_phone", f.business_phone);
  setText("home_address_street", f.address_street);
  setText("home_city_state_zip", combineCityStateZip(f.address_city, f.address_state, f.address_zip));
  setText("home_phone", f.home_phone);
  setText("business_name", f.business_name);
  setText("asset_cash_on_hand_and_in_banks", f.asset_cash_on_hand_and_in_banks);
  setText("asset_savings_accounts", f.asset_savings_accounts);
  setText("asset_ira_retirement", f.asset_ira_retirement);
  setText("asset_accounts_notes_receivable", f.asset_accounts_notes_receivable);
  setText("asset_life_insurance_cash_surrender_value", f.asset_life_insurance_cash_surrender_value);
  setText("asset_stocks_bonds", f.asset_stocks_bonds);
  setText("asset_real_estate", f.asset_real_estate);
  setText("asset_automobile", f.asset_automobile);
  setText("asset_other_personal_property", f.asset_other_personal_property);
  setText("asset_other", f.asset_other);
  setText("asset_total", f.asset_total);
  setText("liability_accounts_payable", f.liability_accounts_payable);
  setText("liability_notes_payable_banks_others", f.liability_notes_payable_banks_others);
  setText("liability_installment_auto", f.liability_installment_auto);
  setText("liability_installment_other", f.liability_installment_other);
  setText("liability_loan_on_life_insurance", f.liability_loan_on_life_insurance);
  setText("liability_mortgages_on_real_estate", f.liability_mortgages_on_real_estate);
  setText("liability_unpaid_taxes", f.liability_unpaid_taxes);
  setText("liability_other", f.liability_other);
  setText("liability_total", f.liability_total);
  setText("net_worth", f.net_worth);
  setText("contingent_as_endorser_or_comaker", f.contingent_as_endorser_or_comaker);
  setText("contingent_legal_claims_judgments", f.contingent_legal_claims_judgments);
  setText("contingent_provision_for_federal_income_tax", f.contingent_provision_for_federal_income_tax);
  setText("contingent_other_special_debt", f.contingent_other_special_debt);
  setText("income_salary", f.income_salary);
  setText("income_net_investment", f.income_net_investment);
  setText("income_real_estate", f.income_real_estate);
  setText("income_other", f.income_other);
  setText("income_other_description", f.income_other_description);
  setText("other_personal_property_description", f.other_personal_property_description);
  setText("unpaid_taxes_description", f.unpaid_taxes_description);
  setText("other_liabilities_description", f.other_liabilities_description);
  setText("life_insurance_description", f.life_insurance_description);
  setText("print_name", f.full_name);
  setText("full_ssn", fullSsn);
  if (f.has_spouse) {
    setText("spouse_print_name", f.spouse_full_name);
    setText("spouse_full_ssn", spouseFullSsn);
  }

  const checkboxValues: Record<string, boolean> = {};
  const businessTypeKey = BUSINESS_TYPE_CHECKBOX[String(f.business_entity_type ?? "").toLowerCase()];
  if (businessTypeKey) checkboxValues[FORM_413_CHECKBOX_FIELDS[businessTypeKey]] = true;
  if (f.has_spouse != null) {
    checkboxValues[FORM_413_CHECKBOX_FIELDS.married_yes] = f.has_spouse === true;
    checkboxValues[FORM_413_CHECKBOX_FIELDS.married_no] = f.has_spouse === false;
  }

  // Section 2 — notes payable (up to 5 rows).
  const notesPayable = Array.isArray(f.notes_payable) ? (f.notes_payable as Array<Record<string, unknown>>) : [];
  notesPayable.slice(0, 5).forEach((row, i) => {
    const slot = FORM_413_NOTES_PAYABLE_FIELDS[i];
    if (row.noteholder_name_address != null) textValues[slot.noteholder] = String(row.noteholder_name_address);
    if (row.original_balance != null) textValues[slot.originalBalance] = String(row.original_balance);
    if (row.current_balance != null) textValues[slot.currentBalance] = String(row.current_balance);
    if (row.payment_amount != null) textValues[slot.paymentAmount] = String(row.payment_amount);
    if (row.payment_frequency != null) textValues[slot.frequency] = String(row.payment_frequency);
    if (row.collateral_description != null) textValues[slot.collateral] = String(row.collateral_description);
  });

  // Section 3 — securities (up to 4 rows).
  const securities = Array.isArray(f.securities) ? (f.securities as Array<Record<string, unknown>>) : [];
  securities.slice(0, 4).forEach((row, i) => {
    const slot = FORM_413_SECURITIES_FIELDS[i];
    if (row.number_of_shares != null) textValues[slot.shares] = String(row.number_of_shares);
    if (row.name_of_securities != null) textValues[slot.name] = String(row.name_of_securities);
    if (row.cost != null) textValues[slot.cost] = String(row.cost);
    if (row.market_value_quotation_exchange != null) textValues[slot.marketValueQuotation] = String(row.market_value_quotation_exchange);
    if (row.date_of_quotation != null) textValues[slot.dateOfQuotation] = String(row.date_of_quotation);
    if (row.total_value != null) textValues[slot.totalValue] = String(row.total_value);
  });

  // Section 4 — up to 3 real estate properties (A/B/C).
  const realEstate = Array.isArray(f.real_estate_properties) ? (f.real_estate_properties as Array<Record<string, unknown>>) : [];
  for (const row of realEstate) {
    const label = row.property_label as "A" | "B" | "C" | undefined;
    if (!label || !FORM_413_REAL_ESTATE_FIELDS[label]) continue;
    const slot = FORM_413_REAL_ESTATE_FIELDS[label];
    if (row.property_type != null) textValues[slot.type] = String(row.property_type);
    if (row.address != null) textValues[slot.address] = String(row.address);
    if (row.date_purchased != null) textValues[slot.datePurchased] = String(row.date_purchased);
    if (row.original_cost != null) textValues[slot.originalCost] = String(row.original_cost);
    if (row.present_market_value != null) textValues[slot.presentMarketValue] = String(row.present_market_value);
    if (row.mortgage_holder_name_address != null) textValues[slot.mortgageHolder] = String(row.mortgage_holder_name_address);
    if (row.mortgage_account_number != null) textValues[slot.mortgageAccountNumber] = String(row.mortgage_account_number);
    if (row.mortgage_balance != null) textValues[slot.mortgageBalance] = String(row.mortgage_balance);
    if (row.mortgage_payment_per_month_year != null) textValues[slot.paymentPerMonthYear] = String(row.mortgage_payment_per_month_year);
    if (row.mortgage_status != null) textValues[slot.status] = String(row.mortgage_status);
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
