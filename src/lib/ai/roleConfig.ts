/**
 * Role → provider/model/failover configuration for the AI gateway
 * (SPEC-M1 AI-GATEWAY-1). Model swaps are a config change here, not a code
 * change, per the program doc's SR 11-7 change-management goal.
 *
 * Defaults (Program-level, per SPEC-M1):
 *   generator   — Gemini, failover to OpenAI
 *   verifier    — Claude (single provider — Invariant #4: at most one
 *                 verifier per artifact; no failover to a second opinion)
 *   structurer  — OpenAI, JSON-schema mode
 *   interviewer — Gemini
 *   translator  — Claude (SPEC-M3 GLASS-BOX-1: the generator for a
 *                 readiness-read artifact — narrates deal_model_snapshots
 *                 numbers in plain English. Deliberately Claude, not
 *                 Gemini/generator's default, for careful instruction-
 *                 following on a borrower-facing surface. verifier still
 *                 independently fact-checks its output — Invariant #4 is
 *                 satisfied because translator IS the generator for this
 *                 artifact, not a second opinion alongside verifier.)
 *
 * Each role's chain/budget can be overridden per-environment via
 * AI_GATEWAY_CHAIN_<ROLE> ("provider:model,provider:model") and
 * AI_GATEWAY_BUDGET_<ROLE> (integer tokens/day) env vars, so a vendor
 * incident or cost issue is a config change, not a deploy.
 */

import { GEMINI_FLASH, OPENAI_CHAT, ANTHROPIC_VERIFIER } from "./models";

export type GatewayRole = "generator" | "verifier" | "structurer" | "interviewer" | "translator";
export type GatewayProvider = "google" | "anthropic" | "openai";

export type RoleStep = {
  provider: GatewayProvider;
  model: string;
  /**
   * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §1 — Google-only. Lets a role's
   * chain step request Vertex/WIF auth instead of the default
   * GEMINI_API_KEY REST path. Ignored for non-google steps.
   */
  authMode?: "api-key" | "vertex";
};

export type RoleConfig = {
  /** First entry is primary; later entries are tried in order on failure. */
  chain: RoleStep[];
  /** Hard daily token cap for this role — runRole refuses once breached. */
  dailyTokenBudget: number;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 25_000;

const DEFAULT_CHAINS: Record<GatewayRole, RoleStep[]> = {
  generator: [
    { provider: "google", model: GEMINI_FLASH },
    { provider: "openai", model: OPENAI_CHAT },
  ],
  verifier: [{ provider: "anthropic", model: ANTHROPIC_VERIFIER }],
  structurer: [{ provider: "openai", model: OPENAI_CHAT }],
  interviewer: [{ provider: "google", model: GEMINI_FLASH }],
  translator: [{ provider: "anthropic", model: ANTHROPIC_VERIFIER }],
};

const DEFAULT_BUDGETS: Record<GatewayRole, number> = {
  generator: 2_000_000,
  verifier: 500_000,
  structurer: 500_000,
  interviewer: 1_000_000,
  translator: 500_000,
};

function isGatewayProvider(v: string): v is GatewayProvider {
  return v === "google" || v === "anthropic" || v === "openai";
}

function chainFromEnv(role: GatewayRole): RoleStep[] | null {
  const raw = process.env[`AI_GATEWAY_CHAIN_${role.toUpperCase()}`];
  if (!raw) return null;

  const steps: RoleStep[] = [];
  for (const segment of raw.split(",")) {
    const [provider, model] = segment.split(":").map((s) => s.trim());
    if (!provider || !model || !isGatewayProvider(provider)) {
      console.warn(
        `[ai-gateway:roleConfig] malformed AI_GATEWAY_CHAIN_${role.toUpperCase()} segment "${segment}" — ignoring override, using default chain`,
      );
      return null;
    }
    steps.push({ provider, model });
  }
  return steps.length ? steps : null;
}

function budgetFromEnv(role: GatewayRole): number | null {
  const raw = process.env[`AI_GATEWAY_BUDGET_${role.toUpperCase()}`];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function getRoleConfig(role: GatewayRole): RoleConfig {
  return {
    chain: chainFromEnv(role) ?? DEFAULT_CHAINS[role],
    dailyTokenBudget: budgetFromEnv(role) ?? DEFAULT_BUDGETS[role],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}
