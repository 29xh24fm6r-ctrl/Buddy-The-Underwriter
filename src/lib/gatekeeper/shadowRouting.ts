/**
 * Shadow Routing Comparison — compares effective doc type AND extraction engine
 * between slot-derived (current) and gatekeeper-derived (proposed) routing.
 * DOES NOT change routing behavior. Pure function — no DB, no IO.
 */
import type { GatekeeperDocType, GatekeeperRoute } from "./types";

// ─── Engine Mapping ─────────────────────────────────────────────────────────

type ExtractionEngine = "DocAI" | "Gemini" | "none";

/** Derive extraction engine from effective doc type (what slot routing does today). */
function slotDerivedEngine(effectiveDocType: string): ExtractionEngine {
  const upper = effectiveDocType.toUpperCase().trim();
  // These types get DOC_AI_ATOMIC routing per docTypeRouting.ts ROUTING_CLASS_MAP
  const DOC_AI_TYPES = new Set([
    "BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN",
    "INCOME_STATEMENT", "BALANCE_SHEET", "PFS",
    // Slot doc type names that map to tax returns
    "IRS_BUSINESS", "IRS_1120", "IRS_1120S", "IRS_1065",
    "IRS_PERSONAL", "IRS_1040", "K1", "SCHEDULE_K1", "W2", "1099",
    "PERSONAL_FINANCIAL_STATEMENT", "SBA_413",
  ]);
  if (DOC_AI_TYPES.has(upper)) return "DocAI";
  return "Gemini";
}

/** Derive extraction engine from gatekeeper route. */
function gatekeeperDerivedEngine(route: GatekeeperRoute | null): ExtractionEngine {
  if (route === "GOOGLE_DOC_AI_CORE") return "DocAI";
  if (route === "STANDARD") return "Gemini";
  return "none"; // NEEDS_REVIEW or null
}

// ─── Comparison ─────────────────────────────────────────────────────────────

export type ShadowCompareResult = {
  documentId: string;
  slotDocType: string | null;
  gatekeeperDocType: GatekeeperDocType | null;
  gatekeeperRoute: GatekeeperRoute | null;
  gatekeeperConfidence: number | null;
  slotEngine: ExtractionEngine;
  gatekeeperEngine: ExtractionEngine;
  divergentDocType: boolean;
  divergentEngine: boolean;
  reason: string | null;
};

export function computeShadowRoutingComparison(args: {
  documentId: string;
  slotDocType: string | null;
  effectiveDocType: string;
  gatekeeperDocType: GatekeeperDocType | null;
  gatekeeperRoute: GatekeeperRoute | null;
  gatekeeperConfidence: number | null;
}): ShadowCompareResult {
  const {
    documentId, slotDocType, effectiveDocType,
    gatekeeperDocType, gatekeeperRoute, gatekeeperConfidence,
  } = args;

  const slotEng = slotDerivedEngine(effectiveDocType);
  const gkEng = gatekeeperDerivedEngine(gatekeeperRoute ?? null);

  // Doc type divergence: only when both sides have a value
  const slotNorm = (slotDocType ?? "").toUpperCase().trim();
  const gkNorm = (gatekeeperDocType ?? "").toUpperCase().trim();
  const divergentDocType = Boolean(slotNorm && gkNorm && slotNorm !== gkNorm);

  // Engine divergence: only when gatekeeper has an opinion (not NEEDS_REVIEW)
  const divergentEngine = gkEng !== "none" && slotEng !== gkEng;

  const reasons: string[] = [];
  if (divergentDocType) reasons.push(`doc_type: slot=${slotNorm} vs gk=${gkNorm}`);
  if (divergentEngine) reasons.push(`engine: slot=${slotEng} vs gk=${gkEng}`);

  return {
    documentId,
    slotDocType,
    gatekeeperDocType,
    gatekeeperRoute: gatekeeperRoute ?? null,
    gatekeeperConfidence: gatekeeperConfidence ?? null,
    slotEngine: slotEng,
    gatekeeperEngine: gkEng,
    divergentDocType,
    divergentEngine,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}
