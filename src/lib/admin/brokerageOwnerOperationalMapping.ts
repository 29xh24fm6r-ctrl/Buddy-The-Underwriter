/**
 * Buddy SBA Owner Operating Command Center — Pure Mapping Helpers
 *
 * Stateless mappers from raw DB row shapes to BrokerageDealRecord /
 * BrokerageActivityEvent. Separated from the server-only adapter so
 * CI tests can import without transitive server-only deps.
 *
 * Spec: 16B / Spec 18 — Owner/Admin Command Center Route Integration
 */

import type {
  BrokerageDealRecord,
  BrokerageActivityEvent,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

// ---------------------------------------------------------------------------
// Raw DB row shapes (minimal projections)
// ---------------------------------------------------------------------------

export type DealRow = {
  id: string;
  borrower_name: string | null;
  business_name: string | null;
  created_by_user_id: string | null;
  updated_at: string | null;
};

export type DealEventRow = {
  id: string;
  deal_id: string;
  kind: string;
  created_at: string;
  payload: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

export function mapDealRowToRecord(row: DealRow): BrokerageDealRecord {
  const borrowerLabel =
    row.business_name?.trim() ||
    row.borrower_name?.trim() ||
    "Unnamed deal";

  return {
    dealId: row.id,
    borrowerLabel,
    assignedTeamMemberId: row.created_by_user_id ?? null,
    lastActivityAt: row.updated_at ?? null,
  };
}

export function mapEventToActivity(row: DealEventRow): BrokerageActivityEvent {
  const label = humanizeEventType(row.kind);
  return {
    id: row.id,
    label,
    timestamp: row.created_at,
    category: categorizeEvent(row.kind),
  };
}

export function humanizeEventType(eventType: string): string {
  return eventType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// substring dispatch: more-specific tokens before less-specific ones
export function categorizeEvent(
  eventType: string,
): BrokerageActivityEvent["category"] {
  if (eventType.includes("submission")) return "submission";
  if (eventType.includes("routing")) return "routing";
  if (eventType.includes("clarification")) return "clarification";
  if (eventType.includes("borrower")) return "borrower";
  return "operations";
}
