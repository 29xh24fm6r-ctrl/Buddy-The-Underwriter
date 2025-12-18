export type CanonicalField =
  | "borrower.name"
  | "borrower.ssn"
  | "borrower.address"
  | "borrower.phone"
  | "borrower.email"
  | "deal.requested_amount"
  | "deal.purpose"
  | "deal.type"
  | "pfs.cash"
  | "pfs.market_securities"
  | "pfs.real_estate"
  | "pfs.total_assets"
  | "pfs.total_liabilities"
  | "pfs.net_worth"
  | "signature.borrower"
  | "signature.date";

export const CANONICAL_FIELDS: CanonicalField[] = [
  "borrower.name",
  "borrower.ssn",
  "borrower.address",
  "borrower.phone",
  "borrower.email",
  "deal.requested_amount",
  "deal.purpose",
  "deal.type",
  "pfs.cash",
  "pfs.market_securities",
  "pfs.real_estate",
  "pfs.total_assets",
  "pfs.total_liabilities",
  "pfs.net_worth",
  "signature.borrower",
  "signature.date",
];
