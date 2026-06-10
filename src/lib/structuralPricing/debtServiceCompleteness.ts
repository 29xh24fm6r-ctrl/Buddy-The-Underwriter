/**
 * SPEC-GLOBAL-DEBT-SERVICE-DENOMINATOR-1 (PR-519) — denominator completeness.
 *
 * Decision (user-confirmed): the BUSINESS DSCR is shown as-is (NCADS / proposed +
 * on-file existing business debt), with a note when no existing-debt schedule is on
 * file. The GLOBAL DSCR (which adds guarantor / personal obligations) is labeled
 * PRELIMINARY whenever those obligations are not affirmatively confirmed — proposed-
 * loan-only or business-only coverage must never silently masquerade as global DSCR.
 *
 * Pure — no DB.
 */

export type DenominatorCompleteness = {
  existingDebtOnFile: boolean;
  /** Business DSCR is always shown; the note qualifies how complete the denominator is. */
  businessNote: string;
  /** Global DSCR is preliminary until guarantor/personal obligations are confirmed. */
  globalDscrPreliminary: boolean;
  globalNote: string;
};

export function assessDenominatorCompleteness(input: {
  /** Existing-debt-schedule rows present for the deal (regardless of payment nulls). */
  existingDebtRowsPresent: boolean;
  /** Guarantor / personal obligations affirmatively known (PFS debt fact or guarantor cashflow). */
  guarantorObligationsConfirmed: boolean;
}): DenominatorCompleteness {
  const existingDebtOnFile = input.existingDebtRowsPresent;
  const globalDscrPreliminary = !input.guarantorObligationsConfirmed;
  return {
    existingDebtOnFile,
    businessNote: existingDebtOnFile
      ? "Business DSCR uses total business debt service (proposed loan + existing business debt on file)."
      : "Business DSCR reflects the proposed loan plus any on-file existing business debt; no existing-debt schedule is on file — confirm there is no other business debt.",
    globalDscrPreliminary,
    globalNote: globalDscrPreliminary
      ? "PRELIMINARY — guarantor/personal obligations are not yet confirmed; global coverage may be lower once they are included."
      : "Global DSCR includes confirmed guarantor/personal obligations.",
  };
}
