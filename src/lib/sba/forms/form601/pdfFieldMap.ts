/**
 * Real AcroForm field names for SBA Form 601 — Agreement of Compliance
 * (10/85, REF: SOP 9030), confirmed against a user-supplied copy of the
 * current PDF (docs/sba-forms/601-fields.json). Field names are literally
 * drawn from the surrounding sentence text (Acrobat's auto-naming, not a
 * deliberate scheme) — verified against the rendered page, not guessed.
 *
 * The applicant's legal name sentence wraps across 2 separate AcroForm
 * fields (a typewriter-era form digitized as-is); only the first is
 * filled — see render.ts. "Executed the ___ day of ___, 20__" and both
 * "Signature of Authorized Official" fields (native PDFSignature) are
 * left for SignWell, same convention as every other form in this arc.
 */

export const FORM_601_TEXT_FIELDS = {
  applicant_name_line1: "In consideration of the approved by the Small Business Administration of a loan to",
  general_contractor_name: "Applicant said Applicant and",
  applicant_name_address_phone: "Name Address  Phone No of Applicant",
  applicant_official_name_title: "Typed Name  Title of Authorized Official",
  subrecipient_name_address_phone: "Name Address  Phone No of Subrecipient",
  contractor_official_name_title: "Typed Name  Title of Authorized Official_2",
} as const;
