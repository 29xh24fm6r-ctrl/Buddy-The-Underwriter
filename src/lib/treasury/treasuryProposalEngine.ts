/**
 * Treasury product proposal engine — recommends treasury management
 * products based on borrower financial data.
 * Pure function — no DB.
 */

export type TreasuryProduct =
  | "LOCKBOX"
  | "ACH_ORIGINATION"
  | "POSITIVE_PAY"
  | "SWEEP_ACCOUNT"
  | "REMOTE_DEPOSIT_CAPTURE";

export type TreasuryProposal = {
  product: TreasuryProduct;
  recommended: boolean;
  rationale: string;
  estimatedAnnualFee: number;
  borrowerBenefit: string;
  dataSignals: string[];
};

export function generateTreasuryProposals(params: {
  avgDailyBalance: number | null;
  accountsReceivable: number | null;
  grossReceipts: number | null;
  salariesWages: number | null;
  depositVolatility: number | null;
  naicsCode: string | null;
}): TreasuryProposal[] {
  const {
    avgDailyBalance,
    accountsReceivable,
    grossReceipts,
    salariesWages,
    naicsCode,
  } = params;

  const proposals: TreasuryProposal[] = [];

  // LOCKBOX
  const dso =
    accountsReceivable !== null && grossReceipts !== null && grossReceipts > 0
      ? accountsReceivable / (grossReceipts / 365)
      : null;
  const lockboxRecommended = dso !== null && dso > 45;
  proposals.push({
    product: "LOCKBOX",
    recommended: lockboxRecommended,
    rationale: lockboxRecommended
      ? `Accounts receivable of $${fmt(accountsReceivable!)} implies DSO of ${Math.round(dso!)} days. Lockbox accelerates collections.`
      : dso !== null
        ? `DSO of ${Math.round(dso)} days is within acceptable range.`
        : "Insufficient data to compute DSO.",
    estimatedAnnualFee:
      lockboxRecommended ? 1200 + grossReceipts! * 0.0002 : 0,
    borrowerBenefit:
      "Reduces DSO by 5-10 days on average, improving working capital.",
    dataSignals: buildSignals({ accountsReceivable, grossReceipts, dso }),
  });

  // ACH_ORIGINATION
  const achRecommended = salariesWages !== null && salariesWages > 50000;
  proposals.push({
    product: "ACH_ORIGINATION",
    recommended: achRecommended,
    rationale: achRecommended
      ? `Annual payroll of $${fmt(salariesWages!)} suggests recurring ACH origination need.`
      : "Payroll volume does not warrant ACH origination.",
    estimatedAnnualFee: achRecommended ? 600 + salariesWages! * 0.0005 : 0,
    borrowerBenefit:
      "Eliminates check printing, reduces payroll processing time.",
    dataSignals: salariesWages !== null ? [`salariesWages=${salariesWages}`] : [],
  });

  // POSITIVE_PAY
  const posPayRecommended = grossReceipts !== null && grossReceipts > 500000;
  proposals.push({
    product: "POSITIVE_PAY",
    recommended: posPayRecommended,
    rationale: posPayRecommended
      ? "Revenue scale suggests check volume that warrants fraud protection."
      : "Revenue scale does not warrant positive pay.",
    estimatedAnnualFee: posPayRecommended ? 600 : 0,
    borrowerBenefit:
      "Protects against check fraud. Industry average loss $1,300/incident.",
    dataSignals:
      grossReceipts !== null ? [`grossReceipts=${grossReceipts}`] : [],
  });

  // SWEEP_ACCOUNT
  const sweepRecommended =
    avgDailyBalance !== null && avgDailyBalance > 100000;
  proposals.push({
    product: "SWEEP_ACCOUNT",
    recommended: sweepRecommended,
    rationale: sweepRecommended
      ? `Average daily balance of $${fmt(avgDailyBalance!)} suggests excess liquidity earning no return.`
      : "Average daily balance does not warrant sweep arrangement.",
    estimatedAnnualFee: 0, // fee is spread, not explicit charge
    borrowerBenefit:
      "Idle balances automatically invested overnight. Earns Fed Funds rate minus spread.",
    dataSignals:
      avgDailyBalance !== null ? [`avgDailyBalance=${avgDailyBalance}`] : [],
  });

  // REMOTE_DEPOSIT_CAPTURE
  const rdcIndustries = ["44", "45", "722", "621"];
  const rdcRecommended =
    naicsCode !== null &&
    rdcIndustries.some((prefix) => naicsCode.startsWith(prefix));
  proposals.push({
    product: "REMOTE_DEPOSIT_CAPTURE",
    recommended: rdcRecommended,
    rationale: rdcRecommended
      ? "Industry type suggests high check receipt volume from customers."
      : "Industry type does not indicate high check receipt volume.",
    estimatedAnnualFee: rdcRecommended ? 480 : 0,
    borrowerBenefit:
      "Eliminates branch deposit trips. Same-day availability.",
    dataSignals: naicsCode !== null ? [`naicsCode=${naicsCode}`] : [],
  });

  return proposals;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function buildSignals(data: {
  accountsReceivable: number | null;
  grossReceipts: number | null;
  dso: number | null;
}): string[] {
  const signals: string[] = [];
  if (data.accountsReceivable !== null)
    signals.push(`accountsReceivable=${data.accountsReceivable}`);
  if (data.grossReceipts !== null)
    signals.push(`grossReceipts=${data.grossReceipts}`);
  if (data.dso !== null) signals.push(`dso=${Math.round(data.dso)}`);
  return signals;
}
