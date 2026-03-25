/**
 * Unified policy resolution for builder advance rates + equity requirements.
 * Layered: bank_policy → product_default → manual_override.
 * Pure module — no DB, no server-only.
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
};

export type ResolvedEquityRequirement = {
  required_pct: number | null;
  source: EquityRequirementSource;
  policy_reference?: string | null;
};

export type BuilderPolicyResolution = {
  advance_rates: ResolvedAdvanceRate[];
  equity_requirement: ResolvedEquityRequirement | null;
};

export type BuilderPolicyContext = {
  product_type?: string | null;
  collateral_types: string[];
  /** Manually saved advance rate overrides keyed by collateral_type */
  manual_advance_rates?: Record<string, number>;
  /** Manual equity override from banker */
  manual_equity_pct?: number | null;
  /** Bank policy overrides (future: parsed from uploaded policy docs) */
  bank_policy_advance_rates?: Record<string, number>;
  bank_policy_equity_pct?: number | null;
  bank_policy_reference?: string | null;
};

// ── Resolver ─────────────────────────────────────────────────────

/**
 * Resolve builder policy for advance rates and equity.
 * Priority: bank_policy > product_default > manual_override (for initial fill).
 * Manual overrides on saved items always win at item level.
 */
export function resolveBuilderPolicy(
  ctx: BuilderPolicyContext,
): BuilderPolicyResolution {
  // ── Advance rates ──
  const advance_rates: ResolvedAdvanceRate[] = ctx.collateral_types.map((ct) => {
    // Manual override on the item itself (highest priority at item level)
    if (ctx.manual_advance_rates?.[ct] != null) {
      return {
        collateral_type: ct,
        advance_rate: ctx.manual_advance_rates[ct],
        source: "manual_override" as const,
      };
    }

    // Bank policy
    if (ctx.bank_policy_advance_rates?.[ct] != null) {
      return {
        collateral_type: ct,
        advance_rate: ctx.bank_policy_advance_rates[ct],
        source: "bank_policy" as const,
        policy_reference: ctx.bank_policy_reference,
      };
    }

    // Product default
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

  return { advance_rates, equity_requirement };
}
