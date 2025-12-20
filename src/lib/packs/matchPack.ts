export type DealLoanShape = {
  loan_type: string | null;
  loan_program: string | null; // e.g. '7A' | '504'
};

export function scorePackMatch(pack: {
  loan_type: string;
  loan_program: string | null;
}, deal: DealLoanShape): number {
  const lt = (deal.loan_type || "").toUpperCase();
  const lp = (deal.loan_program || "").toUpperCase();
  const plt = (pack.loan_type || "").toUpperCase();
  const plp = (pack.loan_program || "").toUpperCase();

  let score = 0;

  if (lt && plt && lt === plt) score += 70;
  if (lp && plp && lp === plp) score += 30;

  // SBA: if loan_type matches but program blank on one side, partial credit
  if (lt && plt && lt === plt && (!lp || !plp)) score += 10;

  return Math.min(100, score);
}
