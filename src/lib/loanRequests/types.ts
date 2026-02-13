export type ProductCategory =
  | "REAL_ESTATE"
  | "LINES_OF_CREDIT"
  | "TERM_LOANS"
  | "SBA"
  | "SPECIALTY";

export type ProductType =
  // Real Estate
  | "CRE_PURCHASE"
  | "CRE_REFI"
  | "CRE_CASH_OUT"
  | "CRE_TERM"
  | "CONSTRUCTION"
  | "LAND"
  | "BRIDGE"
  // Lines of Credit
  | "LOC_SECURED"
  | "LOC_UNSECURED"
  | "LOC_RE_SECURED"
  | "LINE_OF_CREDIT"
  // Term Loans
  | "TERM_SECURED"
  | "TERM_UNSECURED"
  | "C_AND_I_TERM"
  | "EQUIPMENT"
  | "VEHICLE"
  | "WORKING_CAPITAL"
  | "REFINANCE"
  // SBA
  | "SBA_7A"
  | "SBA_7A_STANDARD"
  | "SBA_7A_SMALL"
  | "SBA_504"
  | "SBA_EXPRESS"
  | "SBA_CAPLines"
  // Specialty
  | "ACQUISITION"
  | "FRANCHISE"
  | "ACCOUNTS_RECEIVABLE"
  | "INVENTORY"
  | "OTHER";

export type LoanRequestStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "pricing_requested"
  | "terms_proposed"
  | "terms_accepted"
  | "approved"
  | "declined"
  | "withdrawn"
  | "funded";

export type OccupancyType = "OWNER_OCCUPIED" | "INVESTOR" | "MIXED";

export type RatePreference = "FIXED" | "VARIABLE" | "NO_PREFERENCE";

export type SBAProgram = "7A" | "504" | "EXPRESS" | "COMMUNITY_ADVANTAGE";

export type PropertyAddress = {
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
};

export type RequestDetails = Record<string, unknown>;

export interface LoanRequest {
  id: string;
  deal_id: string;
  bank_id: string | null;
  request_number: number;
  product_type: ProductType;
  requested_amount: number | null;
  loan_purpose: string | null;
  purpose: string | null;
  purpose_category: string | null;
  requested_term_months: number | null;
  requested_amort_months: number | null;
  requested_rate_type: "FIXED" | "VARIABLE" | null;
  rate_type_preference: RatePreference | null;
  requested_rate_index: string | null;
  requested_spread_bps: number | null;
  requested_interest_only_months: number | null;
  request_details: RequestDetails;
  property_type: string | null;
  occupancy_type: OccupancyType | null;
  property_value: number | null;
  purchase_price: number | null;
  down_payment: number | null;
  property_noi: number | null;
  property_address_json: PropertyAddress | null;
  sba_program: SBAProgram | null;
  sba_loan_priority: string | null;
  injection_amount: number | null;
  injection_source: string | null;
  use_of_proceeds: unknown;
  collateral_summary: string | null;
  guarantors_summary: string | null;
  notes: string | null;
  status: LoanRequestStatus;
  preliminary_decision: "APPROVE" | "DECLINE" | "REFER" | "PENDING" | null;
  approved_amount: number | null;
  approved_rate_pct: number | null;
  approved_term_months: number | null;
  approved_amort_months: number | null;
  decision_notes: string | null;
  decision_at: string | null;
  decision_by: string | null;
  active_quote_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  source: "banker" | "borrower_portal" | "api" | "system" | null;
}

export interface LoanRequestInput {
  product_type: ProductType;
  requested_amount?: number | null;
  loan_purpose?: string | null;
  purpose_category?: string | null;
  requested_term_months?: number | null;
  requested_amort_months?: number | null;
  rate_type_preference?: RatePreference | null;
  request_details?: RequestDetails;
  property_type?: string | null;
  occupancy_type?: OccupancyType | null;
  property_value?: number | null;
  purchase_price?: number | null;
  down_payment?: number | null;
  property_noi?: number | null;
  property_address_json?: PropertyAddress | null;
  sba_program?: SBAProgram | null;
  injection_amount?: number | null;
  injection_source?: string | null;
  collateral_summary?: string | null;
  guarantors_summary?: string | null;
  notes?: string | null;
}

export interface ProductTypeConfig {
  code: string;
  label: string;
  category: ProductCategory;
  requires_collateral: boolean;
  requires_real_estate: boolean;
  requires_sba_fields: boolean;
  display_order: number;
  enabled: boolean;
  config_json: Record<string, unknown>;
}
