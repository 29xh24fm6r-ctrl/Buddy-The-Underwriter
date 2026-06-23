/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1
 *
 * Allow-lists for connector kinds and source types accepted by the connector
 * framework + API route. Pure module. source_type values map to the existing
 * sourcePolicy SourceType taxonomy.
 */

import type { SourceType } from "../sourcePolicy";
import type { SourceConnectorKind } from "./types";

/** Connector kinds the manual source-snapshot API route accepts. */
export const ALLOWED_CONNECTOR_KINDS: SourceConnectorKind[] = [
  "manual_url",
  "secretary_of_state",
  "business_registry",
  "public_adverse_screen",
  "trade_or_market_source",
  "competitor_source",
];

/** source_type values a manually attached snapshot may declare. */
export const ALLOWED_SOURCE_TYPES: SourceType[] = [
  "secretary_of_state",
  "business_registry",
  "public_adverse_record_search",
  "court_record",
  "regulatory_filing",
  "government_data",
  "trade_publication",
  "market_research",
  "news_primary",
  "company_primary",
  "borrower_official_website",
  "local_business_record",
  "chamber_or_business_award",
  "unknown_public_web",
];

export function isAllowedConnectorKind(v: unknown): v is SourceConnectorKind {
  return typeof v === "string" && (ALLOWED_CONNECTOR_KINDS as string[]).includes(v);
}

export function isAllowedSourceType(v: unknown): v is SourceType {
  return typeof v === "string" && (ALLOWED_SOURCE_TYPES as string[]).includes(v);
}
