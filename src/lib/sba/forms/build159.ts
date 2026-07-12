/**
 * SBA Form 159 — Fee Disclosure and Compensation Agreement.
 *
 * Buddy Brokerage charges a fee on every deal it packages (borrower_packaging)
 * and, when a lender pick has been made, may also receive a lender referral
 * fee (lender_referral). SBA Form 159 requires both to be itemized — this
 * builder produces the full field payload from deal + brokerage_fee_ledger +
 * lender pick data. It never fabricates compensation figures: a fee row
 * that hasn't been computed yet is surfaced via `missing`, not defaulted.
 *
 * Kept dependency-free like build1919.ts (no "server-only" imports) so it
 * stays usable from plain unit tests. AGENT_NAME mirrors
 * BROKERAGE_BANK_NAME (@/lib/tenant/brokerage) by value rather than import —
 * that module carries a `server-only` guard this pure builder must not pull in.
 */

const AGENT_NAME = "Buddy Brokerage";

export type Sba159FeeLedgerRow = {
  fee_type: string;
  payer_type: string;
  payee_type: string;
  amount_cents: number | null;
  bps: number | null;
  basis_amount_cents: number | null;
  status: string;
};

export type Sba159FeeLine = {
  fee_type: string;
  payer_type: string;
  payee_type: string;
  amount_cents: number | null;
  bps: number | null;
  basis_amount_cents: number | null;
  status: string;
  description: string;
};

export type Sba159Fields = {
  form: "159";
  deal_id: string;
  applicant_name: string | null;
  loan_amount: number | null;
  lender: { bank_id: string | null; name: string | null };
  agent: { name: string; type: string; address: string | null };
  fees: Sba159FeeLine[];
  total_compensation_cents: number;
  compensation_description: string | null;
};

const FEE_TYPE_LABEL: Record<string, string> = {
  borrower_packaging: "SBA loan packaging and application preparation services",
  lender_referral: "Lender referral / origination assistance",
};

function describeFee(fee: Sba159FeeLedgerRow): string {
  const label = FEE_TYPE_LABEL[fee.fee_type] ?? fee.fee_type;
  if (fee.amount_cents != null) {
    return `${label} — $${(fee.amount_cents / 100).toLocaleString()} paid by ${fee.payer_type}`;
  }
  if (fee.bps != null) {
    return `${label} — ${(fee.bps / 100).toFixed(2)}% paid by ${fee.payer_type}`;
  }
  return `${label} — amount not yet determined, paid by ${fee.payer_type}`;
}

export function buildSbaForm159(args: {
  dealId: string;
  applicantName: string | null;
  loanAmount: number | null;
  lenderBankId: string | null;
  lenderBankName: string | null;
  feeLedger: Sba159FeeLedgerRow[];
}): { form: "159"; fields: Sba159Fields; missing: string[] } {
  const missing: string[] = [];
  if (!args.applicantName) missing.push("applicant_name");
  if (args.loanAmount == null) missing.push("loan_amount");

  const activeFees = args.feeLedger.filter(
    (f) => f.status !== "waived" && f.status !== "cancelled",
  );

  const fees: Sba159FeeLine[] = activeFees.map((f) => ({
    fee_type: f.fee_type,
    payer_type: f.payer_type,
    payee_type: f.payee_type,
    amount_cents: f.amount_cents,
    bps: f.bps,
    basis_amount_cents: f.basis_amount_cents,
    status: f.status,
    description: describeFee(f),
  }));

  if (fees.length === 0) missing.push("fees");
  for (const f of fees) {
    if (f.amount_cents == null && f.bps == null) missing.push(`fees.${f.fee_type}.amount`);
  }

  const totalCompensationCents = fees.reduce((sum, f) => sum + (f.amount_cents ?? 0), 0);

  const fields: Sba159Fields = {
    form: "159",
    deal_id: args.dealId,
    applicant_name: args.applicantName,
    loan_amount: args.loanAmount,
    lender: { bank_id: args.lenderBankId, name: args.lenderBankName },
    agent: {
      // Buddy Brokerage is always the agent/packager of record on every
      // Buddy-originated deal — this is a fixed identity, not deal data.
      name: AGENT_NAME,
      type: "loan packager",
      address: null, // No registered brokerage address on file yet — surfaced, not invented.
    },
    fees,
    total_compensation_cents: totalCompensationCents,
    compensation_description: fees.length > 0 ? fees.map((f) => f.description).join("; ") : null,
  };
  if (!fields.agent.address) missing.push("agent.address");

  return { form: "159", fields, missing };
}
