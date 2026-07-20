/**
 * Real AcroForm field names for SBA Form 912, extracted from
 * docs/sba-forms/912-fields.json (dumped via pdf-lib from a user-supplied
 * copy of the current-revision PDF; each mapping below was confirmed
 * against that field's own /TU tooltip, not guessed from the field name
 * alone — 912's internal field names are literally the question text, so
 * confidence here is high).
 *
 * §7 residence history is deliberately NOT mapped. A visual fill-test
 * (fill fake data, render, look at the actual PDF — not just "no
 * exception thrown") proved the obvious mapping wrong: "7. Present
 * Residence Address" renders on the "From:" line of a From/To/Address
 * three-row block, not the address line, and neither field-name nor /TU
 * tooltip nor the widget's page coordinates disambiguate which of the
 * remaining fields ("...to Address", the standalone "Address") holds the
 * actual street address for the present-residence block vs. the
 * prior-residence block. §7 isn't one of the form's compliance questions
 * or the SSN — it's lower-stakes residence-history context SBA's own
 * instructions call omittable for anything over 10 years old — so per
 * this project's standing rule (never guess field placement on a legal
 * document), it's left blank rather than shipped wrong. Revisit only if
 * the real layout can be confirmed against Adobe Acrobat's field
 * highlighting or another tool that shows widget boundaries visually.
 *
 * Signature/initial/administrative fields ("SBA Office", "Loan Number",
 * "Signature", "Date_af_date", and every "Initial*_es_:signer:initials"
 * field) are deliberately not mapped — those are filled by the signer
 * during the SignWell ceremony or by SBA/the lender after submission, not
 * by Buddy's pre-fill step.
 */

export const FORM_912_TEXT_FIELDS: Record<string, string> = {
  business_name_address_email:
    "1a. Name and address of Applicant/Borrower/Assumptor (Firm/Business Name; Street, City, State, Zip Code, and Email):",
  // 1b. holds both the current legal name and any former names in one
  // field — combined at render time, see render.ts.
  full_name_and_former_names:
    "1b. Personal Statement of : (State name in full, if no middle name state NMN, or if initial only indicate initial). List all former names used, and dates each name was used. Use separate sheet if necessary",
  ownership_percentage: "2. Give the percentage of ownership in the small business (if applicable):",
  full_ssn: "3. Social Security Number",
  date_of_birth: "4. Date of Birth (month, day, and year)",
  place_of_birth: "5. Place of Birth (City & State or Foreign Country)",
  alien_registration_number: "If no, please provide an alien registration number",
  home_phone: "Home Telephone No. (include area code)",
  business_phone: "Business Telephone No. (include area code)",
  signer_title: "Title",
};

export const FORM_912_CHECKBOX_FIELDS: Record<string, string> = {
  no_alien_registration_number: "I do not have an alien registration number",
};

export type RadioFieldMap = { fieldName: string; yesOption: string; noOption: string };

export const FORM_912_RADIO_FIELDS: Record<string, RadioFieldMap> = {
  is_us_citizen: {
    fieldName: "Are you a United States Citizen?",
    yesOption: "Yes, I'm a United States Citizen",
    noOption: "No, I'm not a United States Citizen",
  },
  incarcerated_or_indicted_financial_crime: {
    fieldName:
      "Are you currently incarcerated, serving a sentence of imprisonment imposed upon adjudication of guilty or under indictment for a felony or any crime",
    yesOption: "Yes",
    noOption: "No",
  },
  riot_related_conviction_past_year: {
    fieldName:
      "9. In the past year, have you been convicted of a criminal offense committed during and in connection with a riot or civil disorder or other declared disaster?",
    yesOption: "Yes",
    noOption: "No",
  },
  delinquent_child_support_60days: {
    fieldName: "10. Are you currently more than 60 days late on paying any child support obligations?",
    yesOption: "Yes",
    noOption: "No",
  },
};
