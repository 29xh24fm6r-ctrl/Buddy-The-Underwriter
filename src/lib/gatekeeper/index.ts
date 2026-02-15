/**
 * OpenAI Gatekeeper — Barrel Export
 *
 * Exports types + pure routing utilities only.
 * Server-only modules (runGatekeeper, runGatekeeperBatch, classifyWithOpenAI,
 * gatekeeperCache) are NOT re-exported — routes import them directly
 * to avoid client bundle pollution.
 */

export type {
  GatekeeperDocType,
  GatekeeperRoute,
  GatekeeperClassification,
  GatekeeperResult,
  GatekeeperDocInput,
  GatekeeperBatchResult,
} from "./types";

export { computeGatekeeperRoute, mapGatekeeperToCanonicalHint } from "./routing";
