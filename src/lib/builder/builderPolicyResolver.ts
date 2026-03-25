/**
 * Unified policy resolution for builder advance rates + equity requirements.
 * Layered: bank_policy_rules → product_default → manual_override.
 * Pure module — no DB, no server-only.
 *
 * Phase 53A.3: extended to consume structured bank_policy_rules lookup results.
 */

import type { EquityRequirementSource } from "./builderTypes";
import {
  DEFAULT_ADVANCE_RATES,
  DEFAULT_EQUITY_REQUIREMENTS,
} from "./builderPolicyDefaults";

// ── Types ────────────────────────────────────────────────────────

export type ResolvedAdvanceRate = {
  collateral_type: string;
  advance_rate: number;
  source: "bank_policy" | "product_default" | "manual_override";
  policy_reference?: string | null;
  source_document_id?: string | null;
  confidence?: number | null;
};

export type ResolvedEquityRequirement = {
  required_pct: number | null;
  source: EquityRequirementSource;
  policy_reference?: string | null;
  confidence?: number | null;
};

export type ResolvedLtvLimit = {
  limit: number;
  source: "bank_policy" | "product_default";
  policy_reference?: string | null;
};

export type BuilderPolicyResolution = {
  advance_rates: ResolvedAdvanceRate[];
  equity_requirement: ResolvedEquityRequirement | null;
  ltv_limit: ResolvedLtvLimit | null;
};

/** Structured policy lookup result from policyQuery.ts */
export type PolicyLookupInput = {
  advance_rates?: Record<string, { rate: number; reference: string | null; confidence: number | null }>;
  equity_requirement?: { pct: number; reference: string | null; confidence: number | null } | null;
  ltv_limit?: { limit: number; reference: string | null; confidence: number | null } | null;
};

export type BuilderPolicyContext = {
  product_type?: string | null;
  collateral_types: string[];
  /** Manually saved advance rate overrides keyed by collateral_type */
  manual_advance_rates?: Record<string, number>;
  /** Manual equity override from banker */
  manual_equity_pct?: number | null;
  /** Structured bank policy rules (from policyQuery) */
  bank_policy?: PolicyLookupInput | null;
  /** Legacy: direct bank policy overrides (kept for backward compat) */
  bank_policy_advance_rates?: Record<string, number>;
  bank_policy_equity_pct?: number | null;
  bank_policy_reference?: string | null;
};

// ── Resolver ─────────────────────────────────────────────────────

/**
 * Resolve builder policy for advance rates, equity, and LTV limit.
 * Priority: manual_override (item-level) > bank_policy_rules > product_default.
 */
export function resolveBuilderPolicy(
  ctx: BuilderPolicyContext,
): BuilderPolicyResolution {
  const bp = ctx.bank_policy;

  // ── Advance rates ──
  const advance_rates: ResolvedAdvanceRate[] = ctx.collateral_types.map((ct) => {
    // 1. Manual override on the item itself (highest priority)
    if (ctx.manual_advance_rates?.[ct] != null) {
      return {
        collateral_type: ct,
        advance_rate: ctx.manual_advance_rates[ct],
        source: "manual_override" as const,
      };
    }

    // 2. Structured bank policy rules
    if (bp?.advance_rates?.[ct] != null) {
      return {
        collateral_type: ct,
        advance_rate: bp.advance_rates[ct].rate,
        source: "bank_policy" as const,
        policy_reference: bp.advance_rates[ct].reference,
        confidence: bp.advance_rates[ct].confidence,
      };
    }

    // 3. Legacy bank policy context
    if (ctx.bank_policy_advance_rates?.[ct] != null) {
      return {
        collateral_type: ct,
        advance_rate: ctx.bank_policy_advance_rates[ct],
        source: "bank_policy" as const,
        policy_reference: ctx.bank_policy_reference,
      };
    }

    // 4. Product default
    const defaultRate = DEFAULT_ADVANCE_RATES[ct];
    if (defaultRate != null) {
      return {
        collateral_type: ct,
        advance_rate: defaultRate,
        source: "product_default" as const,
      };
    }

    // Unknown type — conservative fallback
    return {
      collateral_type: ct,
      advance_rate: 0.50,
      source: "product_default" as const,
    };
  });

  // ── Equity requirement ──
  let equity_requirement: ResolvedEquityRequirement | null = null;

  if (ctx.manual_equity_pct != null) {
    equity_requirement = {
      required_pct: ctx.manual_equity_pct,
      source: "manual_override",
    };
  } else if (bp?.equity_requirement?.pct != null) {
    equity_requirement = {
      required_pct: bp.equity_requirement.pct,
      source: "bank_policy",
      policy_reference: bp.equity_requirement.reference,
      confidence: bp.equity_requirement.confidence,
    };
  } else if (ctx.bank_policy_equity_pct != null) {
    equity_requirement = {
      required_pct: ctx.bank_policy_equity_pct,
      source: "bank_policy",
      policy_reference: ctx.bank_policy_reference,
    };
  } else if (ctx.product_type) {
    const defaultPct = DEFAULT_EQUITY_REQUIREMENTS[ctx.product_type];
    if (defaultPct != null) {
      equity_requirement = {
        required_pct: defaultPct,
        source: "product_default",
      };
    }
  }

  // ── LTV limit ──
  let ltv_limit: ResolvedLtvLimit | null = null;

  if (bp?.ltv_limit?.limit != null) {
    ltv_limit = {
      limit: bp.ltv_limit.limit,
      source: "bank_policy",
      policy_reference: bp.ltv_limit.reference,
    };
  } else {
    ltv_limit = {
      limit: 0.80,
      source: "product_default",
    };
  }

  return { advance_rates, equity_requirement, ltv_limit };
}
