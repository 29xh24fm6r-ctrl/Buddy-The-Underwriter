import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { RelationshipSurfaceTimelineEntry } from "./types";

type SourceLayer = RelationshipSurfaceTimelineEntry["sourceLayer"];

/**
 * Build a unified, cross-layer timeline for a relationship.
 * Sources: relationship_events, relationship_crypto_events (others added as 65K layers land).
 * Returns descending by eventAt, collapsed duplicates, max 50 entries.
 */
export async function buildRelationshipUnifiedTimeline(
  relationshipId: string,
  bankId: string,
): Promise<RelationshipSurfaceTimelineEntry[]> {
  const sb = supabaseAdmin();
  const entries: RelationshipSurfaceTimelineEntry[] = [];

  // Crypto events (65K.5 — already exists)
  const { data: cryptoEvents } = await sb
    .from("relationship_crypto_events")
    .select("event_code, created_at, payload")
    .eq("relationship_id", relationshipId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(30);

  for (const evt of cryptoEvents ?? []) {
    entries.push(mapEvent("crypto", evt.event_code, evt.created_at, evt.payload));
  }

  // Sort descending by eventAt
  entries.sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());

  // Collapse consecutive no-op duplicates (same code within 60s)
  const collapsed: RelationshipSurfaceTimelineEntry[] = [];
  for (const entry of entries) {
    const prev = collapsed[collapsed.length - 1];
    if (
      prev &&
      prev.eventCode === entry.eventCode &&
      Math.abs(new Date(prev.eventAt).getTime() - new Date(entry.eventAt).getTime()) < 60_000
    ) {
      continue; // skip duplicate
    }
    collapsed.push(entry);
  }

  return collapsed.slice(0, 50);
}

function mapEvent(
  sourceLayer: SourceLayer,
  eventCode: string,
  eventAt: string,
  payload: Record<string, unknown> | null,
): RelationshipSurfaceTimelineEntry {
  const titleMap: Record<string, string> = {
    crypto_position_recorded: "Crypto position recorded",
    crypto_price_snapshot_ingested: "Price snapshot ingested",
    crypto_ltv_changed: "LTV updated",
    crypto_warning_triggered: "Warning threshold triggered",
    crypto_margin_call_opened: "Margin call opened",
    crypto_cure_started: "Cure started",
    crypto_cure_failed: "Cure failed",
    crypto_liquidation_review_opened: "Liquidation review opened",
    crypto_liquidation_approved: "Liquidation approved",
    crypto_liquidation_declined: "Liquidation declined",
    crypto_liquidation_executed: "Liquidation executed",
    crypto_custody_verified: "Custody verified",
    crypto_custody_issue_detected: "Custody issue detected",
    crypto_resolved: "Crypto distress resolved",
  };

  const severityMap: Record<string, "normal" | "warning" | "critical"> = {
    crypto_margin_call_opened: "warning",
    crypto_cure_failed: "critical",
    crypto_liquidation_review_opened: "critical",
    crypto_liquidation_executed: "critical",
    crypto_custody_issue_detected: "warning",
    crypto_warning_triggered: "warning",
  };

  return {
    sourceLayer,
    eventCode,
    eventAt,
    title: titleMap[eventCode] ?? eventCode.replace(/_/g, " "),
    summary: buildSummary(eventCode, payload),
    severity: severityMap[eventCode] ?? "normal",
    href: null,
  };
}

function buildSummary(eventCode: string, payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const parts: string[] = [];
  if (payload.assetSymbol) parts.push(`Asset: ${payload.assetSymbol}`);
  if (payload.currentLtv != null) parts.push(`LTV: ${Number(payload.currentLtv).toFixed(2)}`);
  if (payload.price != null) parts.push(`Price: $${Number(payload.price).toLocaleString()}`);
  if (payload.eventType) parts.push(`Type: ${String(payload.eventType).replace(/_/g, " ")}`);
  return parts.join(" · ");
}
