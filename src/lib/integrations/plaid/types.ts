export type DerivedCategory =
  | "recurring_payment"
  | "payroll"
  | "rent"
  | "mca"
  | "transfer"
  | "sba_loan_payment";

export type DerivedRecurrence = "monthly" | "biweekly" | "weekly" | "irregular";

export type PlaidTransactionLike = {
  transaction_id: string;
  merchant_name?: string | null;
  name?: string | null;
  amount: number;
  date: string;
};

export type ClassifiedTransaction = {
  derived_category: DerivedCategory | null;
  derived_recurrence: DerivedRecurrence | null;
};

export type ConsentCapture = {
  consentVersion: string;
  consentTextHash: string;
  consentIp?: string | null;
  consentUserAgent?: string | null;
};
