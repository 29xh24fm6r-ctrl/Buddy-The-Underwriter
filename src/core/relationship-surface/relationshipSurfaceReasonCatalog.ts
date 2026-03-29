// Pure. No DB. No side effects. No network.
// Master catalog: every 65K reason/blocker maps to one entry.
import type { RelationshipSurfaceReasonEntry } from "./types";

export const REASON_CATALOG: RelationshipSurfaceReasonEntry[] = [
  // ─── Tier 1: Integrity ──────────────────────────────────────────────────────
  { code: "data_integrity_issue", family: "integrity", label: "Data integrity issue", description: "Canonical relationship data cannot be trusted.", precedence: 100, severity: "critical", defaultActionability: "review_required" },
  { code: "recomputation_invalid", family: "integrity", label: "State recomputation failed", description: "Canonical state could not be derived from available facts.", precedence: 101, severity: "critical", defaultActionability: "review_required" },
  { code: "source_evidence_unavailable", family: "integrity", label: "Source evidence unavailable", description: "Required evidence is missing; truth cannot be verified.", precedence: 102, severity: "critical", defaultActionability: "review_required" },

  // ─── Tier 2: Critical distress ──────────────────────────────────────────────
  { code: "critical_monitoring_exception", family: "monitoring", label: "Critical monitoring exception", description: "A critical monitoring exception requires immediate attention.", precedence: 200, severity: "critical", defaultActionability: "execute_now" },
  { code: "critical_renewal_failure", family: "renewal", label: "Critical renewal failure", description: "Renewal has failed or is critically overdue.", precedence: 201, severity: "critical", defaultActionability: "execute_now" },
  { code: "crypto_liquidation_review_required", family: "crypto", label: "Liquidation review required", description: "Crypto collateral has breached liquidation thresholds. Banker approval needed.", precedence: 202, severity: "critical", defaultActionability: "approval_required" },
  { code: "critical_protection_case", family: "protection", label: "Critical protection case", description: "A critical relationship protection case requires intervention.", precedence: 203, severity: "critical", defaultActionability: "execute_now" },
  { code: "cure_expired_critical", family: "crypto", label: "Cure period expired", description: "Margin call cure period has expired without resolution.", precedence: 204, severity: "critical", defaultActionability: "execute_now" },

  // ─── Tier 3: Time-bound review ──────────────────────────────────────────────
  { code: "renewal_overdue", family: "renewal", label: "Renewal overdue", description: "Renewal is open and past its due date.", precedence: 300, severity: "warning", defaultActionability: "execute_now" },
  { code: "annual_review_overdue", family: "review", label: "Annual review overdue", description: "Annual review is past its due date.", precedence: 301, severity: "warning", defaultActionability: "execute_now" },
  { code: "banker_deadline_review", family: "review", label: "Banker review deadline approaching", description: "A banker review has a hard deadline approaching.", precedence: 302, severity: "warning", defaultActionability: "review_required" },
  { code: "protection_renewal_window", family: "protection", label: "Protection intervention in renewal window", description: "Protection work is needed within an active renewal window.", precedence: 303, severity: "warning", defaultActionability: "review_required" },

  // ─── Tier 4: Borrower-blocked work ──────────────────────────────────────────
  { code: "borrower_items_overdue", family: "borrower", label: "Borrower items overdue", description: "Borrower has overdue items blocking progress.", precedence: 400, severity: "warning", defaultActionability: "waiting_on_borrower" },
  { code: "treasury_onboarding_stalled", family: "borrower", label: "Treasury onboarding stalled", description: "Treasury onboarding is stalled waiting on borrower action.", precedence: 401, severity: "warning", defaultActionability: "waiting_on_borrower" },
  { code: "crypto_margin_cure_pending", family: "crypto", label: "Margin cure pending", description: "A margin call cure is in progress; borrower or ops action needed.", precedence: 402, severity: "warning", defaultActionability: "waiting_on_borrower" },
  { code: "borrower_reengagement_required", family: "borrower", label: "Borrower reengagement required", description: "Borrower is disengaged; follow-up required.", precedence: 403, severity: "warning", defaultActionability: "waiting_on_borrower" },

  // ─── Tier 5: Protection work ────────────────────────────────────────────────
  { code: "runoff_risk_high", family: "protection", label: "High runoff risk", description: "Deposit or relationship runoff risk is elevated.", precedence: 500, severity: "warning", defaultActionability: "open_panel" },
  { code: "deterioration_accelerating", family: "protection", label: "Deterioration accelerating", description: "Relationship health is deteriorating at an accelerating pace.", precedence: 501, severity: "warning", defaultActionability: "open_panel" },
  { code: "shallow_renewal_fragility", family: "protection", label: "Shallow renewal fragility", description: "Renewal is proceeding but relationship depth is fragile.", precedence: 502, severity: "warning", defaultActionability: "review_required" },
  { code: "treasury_stall_retention", family: "protection", label: "Treasury stall with retention risk", description: "Treasury onboarding stall may affect retention.", precedence: 503, severity: "warning", defaultActionability: "open_panel" },
  { code: "crypto_warning_open", family: "crypto", label: "Crypto warning threshold breached", description: "Crypto collateral is approaching margin call territory.", precedence: 504, severity: "warning", defaultActionability: "open_panel" },
  { code: "crypto_custody_unverified", family: "crypto", label: "Crypto custody unverified", description: "Custody control not verified for crypto collateral.", precedence: 505, severity: "warning", defaultActionability: "review_required" },
  { code: "crypto_valuation_unavailable", family: "crypto", label: "Crypto valuation unavailable", description: "Price data unavailable for crypto collateral positions.", precedence: 506, severity: "warning", defaultActionability: "review_required" },
  { code: "crypto_margin_call_open", family: "crypto", label: "Crypto margin call open", description: "An active margin call on crypto collateral requires attention.", precedence: 507, severity: "warning", defaultActionability: "execute_now" },
  { code: "crypto_monitoring_stalled", family: "crypto", label: "Crypto monitoring stalled", description: "Crypto monitoring cadence has stalled.", precedence: 508, severity: "warning", defaultActionability: "review_required" },

  // ─── Tier 6: Growth work ────────────────────────────────────────────────────
  { code: "profitability_review", family: "growth", label: "Profitability review available", description: "Relationship profitability analysis is ready for review.", precedence: 600, severity: "normal", defaultActionability: "open_panel" },
  { code: "expansion_review", family: "growth", label: "Expansion opportunity", description: "An expansion opportunity has been identified.", precedence: 601, severity: "normal", defaultActionability: "open_panel" },
  { code: "pricing_context_review", family: "growth", label: "Pricing context review", description: "Pricing context is available for relationship-level review.", precedence: 602, severity: "normal", defaultActionability: "open_panel" },
  { code: "renewal_bundle_opportunity", family: "growth", label: "Renewal bundle opportunity", description: "A bundled renewal/expansion opportunity exists.", precedence: 603, severity: "normal", defaultActionability: "open_panel" },

  // ─── Tier 7: Informational ──────────────────────────────────────────────────
  { code: "healthy_monitoring", family: "informational", label: "Healthy — monitoring only", description: "Relationship is healthy. No immediate action required.", precedence: 700, severity: "normal", defaultActionability: "monitor_only" },
  { code: "no_active_deals", family: "informational", label: "No active deals", description: "No active deals linked to this relationship.", precedence: 701, severity: "normal", defaultActionability: "monitor_only" },
  { code: "deposit_status_unknown", family: "informational", label: "Deposit status unknown", description: "Deposit information is not available.", precedence: 702, severity: "normal", defaultActionability: "monitor_only" },
];

const catalogMap = new Map<string, RelationshipSurfaceReasonEntry>();
for (const entry of REASON_CATALOG) {
  catalogMap.set(entry.code, entry);
}

/** Look up a reason entry by code. Returns undefined if not found. */
export function lookupReason(code: string): RelationshipSurfaceReasonEntry | undefined {
  return catalogMap.get(code);
}

/** Get all known reason codes. */
export function allReasonCodes(): string[] {
  return REASON_CATALOG.map((e) => e.code);
}
