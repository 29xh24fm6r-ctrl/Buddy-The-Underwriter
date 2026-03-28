/**
 * Phase 65K — Watchlist, Special Assets & Workout Types
 *
 * Buddy never invents distress. Every watchlist/workout record must
 * point to evidence. No Omega dependency.
 */

// ── Risk Escalation Ladder ──────────────────────────────────────────────

export type DealOperatingState =
  | "performing"
  | "monitored"
  | "watchlist"
  | "workout"
  | "resolution_pending"
  | "resolved";

// ── Watchlist ───────────────────────────────────────────────────────────

export type WatchlistStatus = "active" | "escalated_to_workout" | "resolved" | "dismissed";
export type WatchlistSeverity = "low" | "moderate" | "high" | "critical";

export type WatchlistReasonCode =
  | "covenant_breach"
  | "dscr_deterioration"
  | "liquidity_stress"
  | "maturity_risk"
  | "reporting_failure"
  | "annual_review_failure"
  | "collateral_decline"
  | "borrower_responsiveness"
  | "other";

export type WatchlistSourceType =
  | "monitoring_trigger"
  | "annual_review"
  | "banker_manual"
  | "renewal"
  | "policy_exception";

// ── Workout ─────────────────────────────────────────────────────────────

export type WorkoutStatus =
  | "active"
  | "modification_in_process"
  | "forbearance_in_process"
  | "refinance_exit"
  | "liquidation_path"
  | "legal_path"
  | "returned_to_pass"
  | "closed_loss"
  | "closed_paid_off"
  | "closed_other";

export type WorkoutSeverity = "high" | "critical";

export type WorkoutStrategy =
  | "short_term_cure"
  | "covenant_reset"
  | "modification"
  | "forbearance"
  | "restructure"
  | "refinance_exit"
  | "sale_exit"
  | "liquidation"
  | "legal_enforcement"
  | "other";

export type WorkoutStage =
  | "triage"
  | "diagnosis"
  | "action_plan"
  | "negotiation"
  | "approval"
  | "execution"
  | "resolution";

export type CriticizedClassification =
  | "pass"
  | "special_mention"
  | "substandard"
  | "doubtful"
  | "loss";

export type ActionItemStatus = "open" | "in_progress" | "blocked" | "completed" | "cancelled";

export type ActionItemType =
  | "request_financials"
  | "obtain_borrower_plan"
  | "update_valuation"
  | "reserve_analysis"
  | "guarantor_review"
  | "site_visit"
  | "modification_term_sheet"
  | "legal_review"
  | "committee_prep"
  | "payoff_quote"
  | "refinance_outreach"
  | "borrower_meeting"
  | "other";

// ── Overlay Snapshot ────────────────────────────────────────────────────

export type OverlayRecommendation =
  | "none"
  | "open_watchlist"
  | "escalate_to_workout"
  | "close_watchlist"
  | "return_to_pass";

export type DealRiskOverlay = {
  dealId: string;
  operatingState: DealOperatingState;
  activeWatchlistCaseId: string | null;
  activeWorkoutCaseId: string | null;
  severity: string | null;
  primaryReasons: string[];
  openActionItemCount: number;
  nextDueAt: string | null;
  lastMaterialEventAt: string | null;
  recommendation: OverlayRecommendation;
};
