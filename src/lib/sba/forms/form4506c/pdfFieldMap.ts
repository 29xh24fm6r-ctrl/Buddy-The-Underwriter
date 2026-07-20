/**
 * Real AcroForm field names for IRS Form 4506-C, extracted from
 * docs/sba-forms/4506c-fields.json (dumped via pdf-lib from a
 * user-supplied copy of the current-revision PDF; confirmed against each
 * field's own /TU tooltip — this is a standard IRS XFA-authored form, so
 * field names are the usual deeply-nested `form1[0].page_1[0]...` paths
 * rather than anything human-readable on their own).
 *
 * §8 (tax year/period requested) is a 4-slot table, each slot split into
 * 2-digit month / 2-digit day / 4-digit year sub-fields (f1_15..f1_26) —
 * see FORM_4506C_TAX_PERIOD_FIELDS below.
 *
 * Deliberately NOT mapped — signer-ceremony fields, filled during the
 * SignWell signing itself, not by Buddy's pre-fill: "signature",
 * "signature_attests" (attestation checkbox), "form_4506c" (signed-by-
 * authorized-representative checkbox), "signatory_confirms", the spouse
 * equivalents of all of those, and both "date" fields.
 */

export const FORM_4506C_TEXT_FIELDS: Record<string, string> = {
  taxpayer_first_name: "form1[0].page_1[0].name_shown[0].first_name[0]",
  taxpayer_middle_initial: "form1[0].page_1[0].name_shown[0].middle_initial[0]",
  taxpayer_last_name: "form1[0].page_1[0].name_shown[0].last_name[0]",
  taxpayer_id: "form1[0].page_1[0].name_shown[0].first_ssn[0]",
  previous_first_name: "form1[0].page_1[0].name_shown[0].previous_first_name[0]",
  previous_last_name: "form1[0].page_1[0].name_shown[0].previous_last_name[0]",
  spouse_first_name: "form1[0].page_1[0].if_a_joint[0].first_name[0]",
  spouse_last_name: "form1[0].page_1[0].if_a_joint[0].last_name[0]",
  spouse_id: "form1[0].page_1[0].if_a_joint[0].second_ssn[0]",
  current_address_street: "form1[0].page_1[0].current_name_address[0].street_address[0]",
  current_address_city: "form1[0].page_1[0].current_name_address[0].city[0]",
  current_address_state: "form1[0].page_1[0].current_name_address[0].state[0]",
  current_address_zip: "form1[0].page_1[0].current_name_address[0].zip_code[0]",
  previous_address_street: "form1[0].page_1[0].previous_address_shown[0].street_address[0]",
  previous_address_city: "form1[0].page_1[0].previous_address_shown[0].city[0]",
  previous_address_state: "form1[0].page_1[0].previous_address_shown[0].state[0]",
  previous_address_zip: "form1[0].page_1[0].previous_address_shown[0].zip_code[0]",
  ives_participant_name: "form1[0].page_1[0].ives_participant_name[0].ives_participant_name[0]",
  ives_participant_id: "form1[0].page_1[0].ives_participant_name[0].ives_participant_id[0]",
  ives_sor_mailbox_id: "form1[0].page_1[0].ives_participant_name[0].sor_mailbox_id[0]",
  ives_street: "form1[0].page_1[0].ives_participant_name[0].street_address[0]",
  ives_city: "form1[0].page_1[0].ives_participant_name[0].city[0]",
  ives_state: "form1[0].page_1[0].ives_participant_name[0].state[0]",
  ives_zip: "form1[0].page_1[0].ives_participant_name[0].zip_code[0]",
  customer_file_number: "form1[0].page_1[0].customer_file_number[0]",
  client_name: "form1[0].page_1[0].client_info[0].first_name[0]",
  client_phone: "form1[0].page_1[0].client_info[0].telephone_number[0]",
  client_street: "form1[0].page_1[0].client_info[0].street_address[0]",
  client_city: "form1[0].page_1[0].client_info[0].city[0]",
  client_state: "form1[0].page_1[0].client_info[0].state[0]",
  client_zip: "form1[0].page_1[0].client_info[0].zip_code[0]",
  tax_form_number_line6: "form1[0].page_1[0].transcript_reqeust[0]",
  wage_income_form_number_1: "form1[0].page_1[0].#subform[9].form_number1[0]",
  wage_income_form_number_2: "form1[0].page_1[0].#subform[9].form_number2[0]",
  wage_income_form_number_3: "form1[0].page_1[0].#subform[9].form_number3[0]",
  signer_print_name: "form1[0].page_1[0].print_type_name[0]",
  signer_title: "form1[0].page_1[0].title[0]",
  signer_phone: "form1[0].page_1[0].phone_number[0]",
  spouse_print_name: "form1[0].page_1[0].print_type_name[1]",
};

/** §8 — up to 4 tax periods, each split into 2-digit month / 2-digit day / 4-digit year sub-fields. */
export const FORM_4506C_TAX_PERIOD_FIELDS: Array<{ month: string; day: string; year: string }> = [
  { month: "form1[0].page_1[0].question_8[0].f1_15[0]", day: "form1[0].page_1[0].question_8[0].f1_16[0]", year: "form1[0].page_1[0].question_8[0].f1_17[0]" },
  { month: "form1[0].page_1[0].question_8[0].f1_18[0]", day: "form1[0].page_1[0].question_8[0].f1_19[0]", year: "form1[0].page_1[0].question_8[0].f1_20[0]" },
  { month: "form1[0].page_1[0].question_8[0].f1_21[0]", day: "form1[0].page_1[0].question_8[0].f1_22[0]", year: "form1[0].page_1[0].question_8[0].f1_23[0]" },
  { month: "form1[0].page_1[0].question_8[0].f1_24[0]", day: "form1[0].page_1[0].question_8[0].f1_25[0]", year: "form1[0].page_1[0].question_8[0].f1_26[0]" },
];

export const FORM_4506C_CHECKBOX_FIELDS: Record<string, string> = {
  transcript_type_return: "form1[0].page_1[0].transcript_type[0].return_transcript[0]",
  transcript_type_account: "form1[0].page_1[0].transcript_type[0].account_transcript[0]",
  transcript_type_record_of_account: "form1[0].page_1[0].transcript_type[0].record_of_account[0]",
  wants_wage_income_transcript: "form1[0].page_1[0].question_7[0]",
  wage_income_for_taxpayer: "form1[0].page_1[0].taxpayer_requesting[0].line_1a[0]",
  wage_income_for_spouse: "form1[0].page_1[0].taxpayer_requesting[0].line_2a[0]",
};
