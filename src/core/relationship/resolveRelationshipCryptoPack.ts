import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveCryptoCollateralValue } from "./deriveCryptoCollateralValue";
import { deriveCryptoCurrentLtv } from "./deriveCryptoCurrentLtv";
import { deriveCryptoThresholdState } from "./deriveCryptoThresholdState";
import { buildCryptoMonitoringCadence } from "./buildCryptoMonitoringCadence";
import { deriveCryptoReasonCodes } from "./deriveCryptoReasonCodes";
import { deriveCryptoRelationshipStatus } from "./deriveCryptoRelationshipStatus";
import { deriveCryptoCollateralHealth } from "./deriveCryptoCollateralHealth";
import { deriveCryptoProtectionReadiness } from "./deriveCryptoProtectionReadiness";
import { deriveCryptoNextActions } from "./deriveCryptoNextActions";
import { buildCryptoExplanations } from "./buildCryptoExplanations";
import type {
  RelationshipCryptoPack,
  CryptoCollateralPosition,
  CryptoPriceSnapshot,
  CryptoMarginEvent,
  CryptoMonitoringProgram,
  CryptoProtectionCase,
  CryptoCustodyStatus,
  CryptoValuationStatus,
  LiquidationApprovalStatus,
} from "./cryptoTypes";

// Row → domain object mappers
function mapPosition(row: Record<string, unknown>): CryptoCollateralPosition {
  return {
    id: row.id as string,
    relationshipId: row.relationship_id as string,
    bankId: row.bank_id as string,
    dealId: (row.deal_id as string) ?? null,
    assetSymbol: row.asset_symbol as string,
    custodyProvider: (row.custody_provider as string) ?? null,
    custodyAccountRef: (row.custody_account_ref as string) ?? null,
    pledgedUnits: Number(row.pledged_units),
    eligibleAdvanceRate: row.eligible_advance_rate != null ? Number(row.eligible_advance_rate) : null,
    haircutPercent: row.haircut_percent != null ? Number(row.haircut_percent) : null,
    marketValueUsd: row.market_value_usd != null ? Number(row.market_value_usd) : null,
    collateralValueUsd: row.collateral_value_usd != null ? Number(row.collateral_value_usd) : null,
    securedExposureUsd: row.secured_exposure_usd != null ? Number(row.secured_exposure_usd) : null,
    currentLtv: row.current_ltv != null ? Number(row.current_ltv) : null,
    warningLtvThreshold: Number(row.warning_ltv_threshold),
    marginCallLtvThreshold: Number(row.margin_call_ltv_threshold),
    liquidationLtvThreshold: Number(row.liquidation_ltv_threshold),
    custodyStatus: row.custody_status as CryptoCustodyStatus,
    valuationStatus: row.valuation_status as CryptoValuationStatus,
    positionStatus: row.position_status as CryptoCollateralPosition["positionStatus"],
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapMarginEvent(row: Record<string, unknown>): CryptoMarginEvent {
  return {
    id: row.id as string,
    relationshipId: row.relationship_id as string,
    bankId: row.bank_id as string,
    collateralPositionId: row.collateral_position_id as string,
    eventType: row.event_type as CryptoMarginEvent["eventType"],
    status: row.status as CryptoMarginEvent["status"],
    ltvAtEvent: row.ltv_at_event != null ? Number(row.ltv_at_event) : null,
    thresholdAtEvent: row.threshold_at_event != null ? Number(row.threshold_at_event) : null,
    cureDueAt: (row.cure_due_at as string) ?? null,
    resolvedAt: (row.resolved_at as string) ?? null,
    borrowerPackageId: (row.borrower_package_id as string) ?? null,
    approvalRequired: row.approval_required as boolean,
    approvalStatus: row.approval_status as LiquidationApprovalStatus,
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  };
}

function mapMonitoringProgram(row: Record<string, unknown>): CryptoMonitoringProgram {
  return {
    id: row.id as string,
    relationshipId: row.relationship_id as string,
    bankId: row.bank_id as string,
    status: row.status as CryptoMonitoringProgram["status"],
    cadence: row.cadence as CryptoMonitoringProgram["cadence"],
    triggerMode: row.trigger_mode as string,
    lastEvaluatedAt: (row.last_evaluated_at as string) ?? null,
    nextEvaluateAt: (row.next_evaluate_at as string) ?? null,
    config: (row.config as Record<string, unknown>) ?? {},
    evidence: (row.evidence as Record<string, unknown>) ?? {},
  };
}

function mapProtectionCase(row: Record<string, unknown>): CryptoProtectionCase {
  return {
    id: row.id as string,
    relationshipId: row.relationship_id as string,
    bankId: row.bank_id as string,
    marginEventId: row.margin_event_id as string,
    status: row.status as CryptoProtectionCase["status"],
    ownerUserId: (row.owner_user_id as string) ?? null,
    bankerReviewRequired: row.banker_review_required as boolean,
    bankerReviewCompletedAt: (row.banker_review_completed_at as string) ?? null,
    bankerReviewCompletedBy: (row.banker_review_completed_by as string) ?? null,
    outcome: (row.outcome as Record<string, unknown>) ?? {},
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    openedAt: row.opened_at as string,
    resolvedAt: (row.resolved_at as string) ?? null,
    closedAt: (row.closed_at as string) ?? null,
  };
}

/**
 * Resolve the full crypto pack for a relationship.
 * Never throws. Returns a safe default on failure.
 */
export async function resolveRelationshipCryptoPack(
  relationshipId: string,
  bankId: string,
): Promise<RelationshipCryptoPack> {
  const emptyPack: RelationshipCryptoPack = {
    cryptoRelationshipStatus: "not_applicable",
    cryptoCollateralHealth: "unknown",
    cryptoValuationStatus: "unavailable",
    cryptoCustodyStatus: "unverified",
    liquidationApprovalStatus: "not_applicable",
    activeCryptoPositionCount: 0,
    activeMarginCallCount: 0,
    activeCryptoProtectionCaseCount: 0,
    currentWeightedLtv: null,
    nearestWarningThreshold: null,
    nearestMarginCallThreshold: null,
    nearestLiquidationThreshold: null,
    triggerMonitoringCadence: "manual",
    cryptoProtectionReadiness: "not_applicable",
    openCryptoReasonCodes: [],
    nextActions: [],
    blockers: [],
    explanations: ["No active crypto collateral positions for this relationship."],
  };

  try {
    const sb = supabaseAdmin();

    // Parallel DB reads
    const [positionsRes, marginEventsRes, monitoringRes, casesRes] = await Promise.all([
      sb
        .from("relationship_crypto_collateral_positions")
        .select("*")
        .eq("relationship_id", relationshipId)
        .eq("bank_id", bankId)
        .eq("position_status", "active"),
      sb
        .from("relationship_crypto_margin_events")
        .select("*")
        .eq("relationship_id", relationshipId)
        .eq("bank_id", bankId)
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false }),
      sb
        .from("relationship_crypto_monitoring_programs")
        .select("*")
        .eq("relationship_id", relationshipId)
        .eq("bank_id", bankId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle(),
      sb
        .from("relationship_crypto_protection_cases")
        .select("*")
        .eq("relationship_id", relationshipId)
        .eq("bank_id", bankId)
        .is("closed_at", null),
    ]);

    const positions = (positionsRes.data ?? []).map(mapPosition);
    const openMarginEvents = (marginEventsRes.data ?? []).map(mapMarginEvent);
    const monitoringProgram = monitoringRes.data
      ? mapMonitoringProgram(monitoringRes.data)
      : null;
    const activeCases = (casesRes.data ?? []).map(mapProtectionCase);

    if (positions.length === 0) return emptyPack;

    const nowIso = new Date().toISOString();

    // Run pure derivation chain
    const reasonCodes = deriveCryptoReasonCodes({
      positions,
      openMarginEvents,
      monitoringProgram,
      nowIso,
    });

    const cryptoRelationshipStatus = deriveCryptoRelationshipStatus({
      reasonCodes,
      openMarginEvents,
      activeCases,
      activePositionCount: positions.length,
    });

    const cryptoCollateralHealth = deriveCryptoCollateralHealth({ positions });

    const cryptoProtectionReadiness = deriveCryptoProtectionReadiness({
      openMarginEvents,
      activeCases,
    });

    const nextActions = deriveCryptoNextActions({
      positions,
      openMarginEvents,
      activeCases,
      reasonCodes,
      monitoringProgram,
    });

    // Compute weighted LTV
    let totalExposure = 0;
    let totalCollateral = 0;
    for (const pos of positions) {
      if (pos.securedExposureUsd != null) totalExposure += pos.securedExposureUsd;
      if (pos.collateralValueUsd != null) totalCollateral += pos.collateralValueUsd;
    }
    const currentWeightedLtv = totalCollateral > 0 ? totalExposure / totalCollateral : null;

    // Nearest thresholds
    const nearestWarningThreshold = positions.length > 0
      ? Math.min(...positions.map((p) => p.warningLtvThreshold))
      : null;
    const nearestMarginCallThreshold = positions.length > 0
      ? Math.min(...positions.map((p) => p.marginCallLtvThreshold))
      : null;
    const nearestLiquidationThreshold = positions.length > 0
      ? Math.min(...positions.map((p) => p.liquidationLtvThreshold))
      : null;

    // Worst valuation status
    const valuationStatuses = positions.map((p) => p.valuationStatus);
    const cryptoValuationStatus = valuationStatuses.includes("unavailable")
      ? "unavailable" as const
      : valuationStatuses.includes("stale")
        ? "stale" as const
        : "current" as const;

    // Worst custody status
    const custodyStatuses = positions.map((p) => p.custodyStatus);
    const cryptoCustodyStatus = custodyStatuses.includes("control_issue")
      ? "control_issue" as const
      : custodyStatuses.includes("unverified")
        ? "unverified" as const
        : custodyStatuses.includes("transfer_pending")
          ? "transfer_pending" as const
          : "verified" as const;

    // Liquidation approval status
    const liquidationEvents = openMarginEvents.filter(
      (e) => e.eventType === "liquidation_review_opened",
    );
    const liquidationApprovalStatus = liquidationEvents.length > 0
      ? liquidationEvents[0].approvalStatus
      : "not_applicable" as const;

    // Monitoring cadence (worst across positions)
    const cadenceOrder = ["daily", "12h", "6h", "1h", "15m", "manual"] as const;
    let worstCadenceIdx = 0;
    for (const pos of positions) {
      const cadence = buildCryptoMonitoringCadence({
        currentLtv: pos.currentLtv,
        warningLtvThreshold: pos.warningLtvThreshold,
        marginCallLtvThreshold: pos.marginCallLtvThreshold,
        liquidationLtvThreshold: pos.liquidationLtvThreshold,
        valuationStatus: pos.valuationStatus,
        collateralValueUsd: pos.collateralValueUsd,
      });
      const idx = cadenceOrder.indexOf(cadence);
      if (idx > worstCadenceIdx) worstCadenceIdx = idx;
    }
    const triggerMonitoringCadence = cadenceOrder[worstCadenceIdx];

    // Active margin calls
    const activeMarginCallCount = openMarginEvents.filter(
      (e) => e.eventType === "margin_call_opened" && e.status === "open",
    ).length;

    // Blockers
    const blockers = [];
    if (cryptoValuationStatus === "unavailable") {
      blockers.push({
        code: "crypto_valuation_unavailable" as const,
        blockingParty: "system" as const,
        description: "Crypto valuation is unavailable for one or more positions.",
        evidence: {},
      });
    }
    if (cryptoCustodyStatus === "unverified" || cryptoCustodyStatus === "control_issue") {
      blockers.push({
        code: "crypto_custody_unverified" as const,
        blockingParty: "banker" as const,
        description: "Custody control has not been verified for one or more positions.",
        evidence: {},
      });
    }
    if (activeMarginCallCount > 0) {
      blockers.push({
        code: "crypto_margin_call_open" as const,
        blockingParty: "banker" as const,
        description: `${activeMarginCallCount} active margin call(s) require attention.`,
        evidence: { activeMarginCallCount },
      });
    }
    if (liquidationEvents.length > 0) {
      blockers.push({
        code: "crypto_liquidation_review_required" as const,
        blockingParty: "banker" as const,
        description: "Liquidation review is required.",
        evidence: {},
      });
    }

    const explanations = buildCryptoExplanations({
      cryptoRelationshipStatus,
      cryptoCollateralHealth,
      activeCryptoPositionCount: positions.length,
      activeMarginCallCount,
      triggerMonitoringCadence,
      currentWeightedLtv,
      reasonCodes,
      nextActions,
    });

    return {
      cryptoRelationshipStatus,
      cryptoCollateralHealth,
      cryptoValuationStatus,
      cryptoCustodyStatus,
      liquidationApprovalStatus,
      activeCryptoPositionCount: positions.length,
      activeMarginCallCount,
      activeCryptoProtectionCaseCount: activeCases.length,
      currentWeightedLtv,
      nearestWarningThreshold,
      nearestMarginCallThreshold,
      nearestLiquidationThreshold,
      triggerMonitoringCadence,
      cryptoProtectionReadiness,
      openCryptoReasonCodes: reasonCodes,
      nextActions,
      blockers,
      explanations,
    };
  } catch (err) {
    console.error("[resolveRelationshipCryptoPack] error:", err);
    return emptyPack;
  }
}
