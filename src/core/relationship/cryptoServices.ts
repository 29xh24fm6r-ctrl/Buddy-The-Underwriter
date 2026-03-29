import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveCryptoCollateralValue } from "./deriveCryptoCollateralValue";
import { deriveCryptoCurrentLtv } from "./deriveCryptoCurrentLtv";
import { logRelationshipCryptoEvent } from "./logRelationshipCryptoEvent";
import type {
  CryptoCollateralPosition,
  CryptoMarginEventType,
  LiquidationApprovalStatus,
} from "./cryptoTypes";

// ---------------------------------------------------------------------------
// upsertCryptoCollateralPosition
// ---------------------------------------------------------------------------

export async function upsertCryptoCollateralPosition(params: {
  id?: string;
  relationshipId: string;
  bankId: string;
  dealId?: string | null;
  assetSymbol: string;
  custodyProvider?: string | null;
  custodyAccountRef?: string | null;
  pledgedUnits: number;
  eligibleAdvanceRate?: number | null;
  haircutPercent?: number | null;
  securedExposureUsd?: number | null;
  warningLtvThreshold: number;
  marginCallLtvThreshold: number;
  liquidationLtvThreshold: number;
  evidence?: Record<string, unknown>;
}): Promise<{ ok: true; positionId: string } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    const upsertData: Record<string, unknown> = {
      relationship_id: params.relationshipId,
      bank_id: params.bankId,
      deal_id: params.dealId ?? null,
      asset_symbol: params.assetSymbol,
      custody_provider: params.custodyProvider ?? null,
      custody_account_ref: params.custodyAccountRef ?? null,
      pledged_units: params.pledgedUnits,
      eligible_advance_rate: params.eligibleAdvanceRate ?? null,
      haircut_percent: params.haircutPercent ?? null,
      secured_exposure_usd: params.securedExposureUsd ?? null,
      warning_ltv_threshold: params.warningLtvThreshold,
      margin_call_ltv_threshold: params.marginCallLtvThreshold,
      liquidation_ltv_threshold: params.liquidationLtvThreshold,
      evidence: params.evidence ?? {},
      updated_at: new Date().toISOString(),
    };

    if (params.id) {
      upsertData.id = params.id;
    }

    const { data, error } = await sb
      .from("relationship_crypto_collateral_positions")
      .upsert(upsertData)
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };

    await logRelationshipCryptoEvent({
      relationshipId: params.relationshipId,
      bankId: params.bankId,
      eventCode: "crypto_position_recorded",
      payload: { positionId: data.id, assetSymbol: params.assetSymbol },
    });

    return { ok: true, positionId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// ingestCryptoPriceSnapshot
// ---------------------------------------------------------------------------

export async function ingestCryptoPriceSnapshot(params: {
  relationshipId: string;
  bankId: string;
  assetSymbol: string;
  priceSource: string;
  referencePriceUsd: number;
  sourceTimestamp: string;
  evidence?: Record<string, unknown>;
}): Promise<{ ok: true; snapshotId: string } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("relationship_crypto_price_snapshots")
      .insert({
        relationship_id: params.relationshipId,
        bank_id: params.bankId,
        asset_symbol: params.assetSymbol,
        price_source: params.priceSource,
        reference_price_usd: params.referencePriceUsd,
        source_timestamp: params.sourceTimestamp,
        evidence: params.evidence ?? {},
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };

    await logRelationshipCryptoEvent({
      relationshipId: params.relationshipId,
      bankId: params.bankId,
      eventCode: "crypto_price_snapshot_ingested",
      payload: { snapshotId: data.id, assetSymbol: params.assetSymbol, price: params.referencePriceUsd },
    });

    return { ok: true, snapshotId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// refreshCryptoTriggerState — recompute LTV from latest price
// ---------------------------------------------------------------------------

export async function refreshCryptoTriggerState(params: {
  positionId: string;
  relationshipId: string;
  bankId: string;
}): Promise<{ ok: true; currentLtv: number | null } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    // Load position
    const { data: pos } = await sb
      .from("relationship_crypto_collateral_positions")
      .select("*")
      .eq("id", params.positionId)
      .single();

    if (!pos) return { ok: false, error: "Position not found" };

    // Load latest price snapshot for this asset
    const { data: latestPrice } = await sb
      .from("relationship_crypto_price_snapshots")
      .select("reference_price_usd, ingested_at")
      .eq("relationship_id", params.relationshipId)
      .eq("bank_id", params.bankId)
      .eq("asset_symbol", pos.asset_symbol)
      .order("ingested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const referencePriceUsd = latestPrice?.reference_price_usd
      ? Number(latestPrice.reference_price_usd)
      : null;

    // Derive values
    const { marketValueUsd, collateralValueUsd } = deriveCryptoCollateralValue({
      pledgedUnits: Number(pos.pledged_units),
      referencePriceUsd,
      haircutPercent: pos.haircut_percent != null ? Number(pos.haircut_percent) : null,
      eligibleAdvanceRate: pos.eligible_advance_rate != null ? Number(pos.eligible_advance_rate) : null,
    });

    const currentLtv = deriveCryptoCurrentLtv({
      securedExposureUsd: pos.secured_exposure_usd != null ? Number(pos.secured_exposure_usd) : null,
      collateralValueUsd,
    });

    // Determine valuation status
    let valuationStatus = "unavailable";
    if (latestPrice?.ingested_at) {
      const hoursAgo = (Date.now() - new Date(latestPrice.ingested_at).getTime()) / (1000 * 60 * 60);
      valuationStatus = hoursAgo < 24 ? "current" : "stale";
    }

    // Update position
    await sb
      .from("relationship_crypto_collateral_positions")
      .update({
        market_value_usd: marketValueUsd,
        collateral_value_usd: collateralValueUsd,
        current_ltv: currentLtv,
        valuation_status: valuationStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.positionId);

    await logRelationshipCryptoEvent({
      relationshipId: params.relationshipId,
      bankId: params.bankId,
      eventCode: "crypto_ltv_changed",
      payload: { positionId: params.positionId, currentLtv, valuationStatus },
    });

    return { ok: true, currentLtv };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// openCryptoMarginEvent
// ---------------------------------------------------------------------------

export async function openCryptoMarginEvent(params: {
  relationshipId: string;
  bankId: string;
  collateralPositionId: string;
  eventType: CryptoMarginEventType;
  ltvAtEvent: number | null;
  thresholdAtEvent: number | null;
  cureDueAt?: string | null;
  approvalRequired?: boolean;
  actorUserId?: string | null;
  evidence?: Record<string, unknown>;
}): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    // Dedupe: check for same event type on same position that is still open
    const { data: existing } = await sb
      .from("relationship_crypto_margin_events")
      .select("id")
      .eq("collateral_position_id", params.collateralPositionId)
      .eq("event_type", params.eventType)
      .in("status", ["open", "in_progress"])
      .limit(1)
      .maybeSingle();

    if (existing) {
      return { ok: false, error: `Duplicate: ${params.eventType} already open for this position` };
    }

    const approvalRequired = params.approvalRequired ?? params.eventType === "liquidation_review_opened";
    const approvalStatus: LiquidationApprovalStatus = approvalRequired
      ? "review_required"
      : "not_applicable";

    const { data, error } = await sb
      .from("relationship_crypto_margin_events")
      .insert({
        relationship_id: params.relationshipId,
        bank_id: params.bankId,
        collateral_position_id: params.collateralPositionId,
        event_type: params.eventType,
        status: "open",
        ltv_at_event: params.ltvAtEvent,
        threshold_at_event: params.thresholdAtEvent,
        cure_due_at: params.cureDueAt ?? null,
        approval_required: approvalRequired,
        approval_status: approvalStatus,
        evidence: params.evidence ?? {},
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };

    const eventCodeMap: Record<string, string> = {
      warning_triggered: "crypto_warning_triggered",
      margin_call_opened: "crypto_margin_call_opened",
      cure_started: "crypto_cure_started",
      liquidation_review_opened: "crypto_liquidation_review_opened",
    };

    await logRelationshipCryptoEvent({
      relationshipId: params.relationshipId,
      bankId: params.bankId,
      eventCode: (eventCodeMap[params.eventType] ?? params.eventType) as any,
      actorType: params.actorUserId ? "banker" : "system",
      actorUserId: params.actorUserId,
      payload: { marginEventId: data.id, eventType: params.eventType, ltvAtEvent: params.ltvAtEvent },
    });

    return { ok: true, eventId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// approveCryptoLiquidation — human gate only
// ---------------------------------------------------------------------------

export async function approveCryptoLiquidation(params: {
  marginEventId: string;
  relationshipId: string;
  bankId: string;
  approved: boolean;
  actorUserId: string;
  evidence?: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    // Verify event exists and is in review_required state
    const { data: evt } = await sb
      .from("relationship_crypto_margin_events")
      .select("id, approval_status, event_type")
      .eq("id", params.marginEventId)
      .eq("bank_id", params.bankId)
      .single();

    if (!evt) return { ok: false, error: "Margin event not found" };
    if (evt.approval_status !== "review_required") {
      return { ok: false, error: `Cannot approve: current status is ${evt.approval_status}` };
    }

    const newStatus: LiquidationApprovalStatus = params.approved ? "approved" : "declined";

    const { error } = await sb
      .from("relationship_crypto_margin_events")
      .update({
        approval_status: newStatus,
        status: params.approved ? "in_progress" : "resolved",
        resolved_at: params.approved ? null : new Date().toISOString(),
        evidence: params.evidence ?? {},
      })
      .eq("id", params.marginEventId);

    if (error) return { ok: false, error: error.message };

    await logRelationshipCryptoEvent({
      relationshipId: params.relationshipId,
      bankId: params.bankId,
      eventCode: params.approved ? "crypto_liquidation_approved" : "crypto_liquidation_declined",
      actorType: "banker",
      actorUserId: params.actorUserId,
      payload: { marginEventId: params.marginEventId, approved: params.approved },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// resolveCryptoMarginEvent — with banker-confirmed evidence
// ---------------------------------------------------------------------------

export async function resolveCryptoMarginEvent(params: {
  marginEventId: string;
  relationshipId: string;
  bankId: string;
  actorUserId: string;
  evidence: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    const { error } = await sb
      .from("relationship_crypto_margin_events")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        evidence: params.evidence,
      })
      .eq("id", params.marginEventId)
      .eq("bank_id", params.bankId);

    if (error) return { ok: false, error: error.message };

    await logRelationshipCryptoEvent({
      relationshipId: params.relationshipId,
      bankId: params.bankId,
      eventCode: "crypto_resolved",
      actorType: "banker",
      actorUserId: params.actorUserId,
      payload: { marginEventId: params.marginEventId },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// upsertCryptoMonitoringProgram
// ---------------------------------------------------------------------------

export async function upsertCryptoMonitoringProgram(params: {
  relationshipId: string;
  bankId: string;
  cadence: string;
  config?: Record<string, unknown>;
}): Promise<{ ok: true; programId: string } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("relationship_crypto_monitoring_programs")
      .upsert(
        {
          relationship_id: params.relationshipId,
          bank_id: params.bankId,
          status: "active",
          cadence: params.cadence,
          trigger_mode: "threshold_proximity",
          config: params.config ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "relationship_id" },
      )
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, programId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
