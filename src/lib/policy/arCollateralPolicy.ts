import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBankPolicyRules } from "./policyQuery";

export type ArCollateralPolicy = {
  advanceRate: number;
  concentrationLimit: number;
  concentrationReserve: number;
  dilutionReserve: number;
  source: "bank_policy" | "default" | "mixed";
};

const DEFAULTS = {
  advanceRate: 0.80,
  concentrationLimit: 0.20,
  concentrationReserve: 0.05,
  dilutionReserve: 0.05,
} as const;

/**
 * Resolve AR-collateral policy parameters for a bank.
 * Reads bank_policy_rules where collateral_type = 'AR'; falls back to defaults
 * for any policy_type the bank hasn't configured.
 *
 * policy_type vocabulary used here:
 *   - advance_rate            (numeric fraction 0..1)
 *   - concentration_limit     (numeric fraction 0..1, max single-customer share)
 *   - concentration_reserve   (numeric fraction 0..1)
 *   - dilution_reserve        (numeric fraction 0..1)
 */
export async function getArCollateralPolicy(
  sb: SupabaseClient,
  bankId: string,
): Promise<ArCollateralPolicy> {
  const rules = await loadBankPolicyRules(sb, bankId);
  const arRules = rules.filter((r) => r.collateral_type === "AR");

  function pick(policyType: string, fallback: number): { value: number; fromBank: boolean } {
    const matches = arRules
      .filter((r) => r.policy_type === policyType && r.rule_value != null)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    if (matches.length > 0 && matches[0].rule_value != null) {
      return { value: Number(matches[0].rule_value), fromBank: true };
    }
    return { value: fallback, fromBank: false };
  }

  const ar = pick("advance_rate", DEFAULTS.advanceRate);
  const cl = pick("concentration_limit", DEFAULTS.concentrationLimit);
  const cr = pick("concentration_reserve", DEFAULTS.concentrationReserve);
  const dr = pick("dilution_reserve", DEFAULTS.dilutionReserve);

  const fromBankFlags = [ar.fromBank, cl.fromBank, cr.fromBank, dr.fromBank];
  const allBank = fromBankFlags.every(Boolean);
  const noneBank = fromBankFlags.every((f) => !f);
  const source: ArCollateralPolicy["source"] =
    allBank ? "bank_policy" : noneBank ? "default" : "mixed";

  return {
    advanceRate: ar.value,
    concentrationLimit: cl.value,
    concentrationReserve: cr.value,
    dilutionReserve: dr.value,
    source,
  };
}
