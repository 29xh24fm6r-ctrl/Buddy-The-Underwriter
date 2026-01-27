/**
 * Policy Resolution Engine (Phase J)
 *
 * Resolves the correct policy pack for a given bank + deal context.
 * Freezes the policy hash at decision time so the exact rules applied
 * are immutably recorded in the decision snapshot.
 *
 * Rules:
 *  - Resolve policy by (bank_id, effective_at)
 *  - Freeze policy at decision time
 *  - Store policy hash in decision snapshot (Phase F)
 *  - Never resolve a superseded policy unless explicitly requested
 */
import "server-only";

import {
  getActivePolicyPack,
  type BankPolicyPack,
  type BankPolicyPackSummary,
  summarizePolicyPack,
} from "./bankPolicyRegistry";

// ── Types ──────────────────────────────────────────────

export type PolicyResolutionResult = {
  ok: boolean;
  bank_id: string;
  resolved_at: string;
  effective_at: string;
  policy_pack: BankPolicyPack | null;
  policy_summary: BankPolicyPackSummary | null;
  resolution_method: "active_at_time" | "latest_active" | "fallback_empty";
  warnings: string[];
};

export type FrozenPolicyReference = {
  bank_id: string;
  policy_id: string;
  policy_version: string;
  policy_hash: string;
  frozen_at: string;
  effective_at: string;
  rule_count: number;
};

// ── Resolution ─────────────────────────────────────────

/**
 * Resolve the active policy pack for a bank at a given point in time.
 *
 * @param bankId - The bank to resolve policy for
 * @param effectiveAt - ISO timestamp; if omitted, uses current time
 */
export async function resolvePolicyContext(
  bankId: string,
  effectiveAt?: string,
): Promise<PolicyResolutionResult> {
  const resolvedAt = new Date().toISOString();
  const targetTime = effectiveAt ?? resolvedAt;
  const warnings: string[] = [];

  // Try to resolve policy pack at the given time
  const pack = await getActivePolicyPack(bankId, targetTime);

  if (pack) {
    return {
      ok: true,
      bank_id: bankId,
      resolved_at: resolvedAt,
      effective_at: pack.effective_at,
      policy_pack: pack,
      policy_summary: summarizePolicyPack(pack),
      resolution_method: effectiveAt ? "active_at_time" : "latest_active",
      warnings,
    };
  }

  // No policy found — try latest active without time constraint
  if (effectiveAt) {
    const latestPack = await getActivePolicyPack(bankId);
    if (latestPack) {
      warnings.push(
        `No policy active at ${targetTime}. Falling back to latest active policy ` +
        `(effective ${latestPack.effective_at}).`,
      );
      return {
        ok: true,
        bank_id: bankId,
        resolved_at: resolvedAt,
        effective_at: latestPack.effective_at,
        policy_pack: latestPack,
        policy_summary: summarizePolicyPack(latestPack),
        resolution_method: "latest_active",
        warnings,
      };
    }
  }

  // No policy at all — return empty fallback
  warnings.push(
    `No active policy found for bank ${bankId}. Using empty policy (no rules).`,
  );
  return {
    ok: false,
    bank_id: bankId,
    resolved_at: resolvedAt,
    effective_at: targetTime,
    policy_pack: null,
    policy_summary: null,
    resolution_method: "fallback_empty",
    warnings,
  };
}

/**
 * Freeze a policy reference for inclusion in a decision snapshot.
 * This creates an immutable pointer to the exact policy used.
 */
export function freezePolicyReference(
  pack: BankPolicyPack,
): FrozenPolicyReference {
  return {
    bank_id: pack.bank_id,
    policy_id: pack.policy_id,
    policy_version: pack.policy_version,
    policy_hash: pack.policy_hash,
    frozen_at: new Date().toISOString(),
    effective_at: pack.effective_at,
    rule_count: pack.rules.length,
  };
}

/**
 * Validate that a frozen policy reference still matches the pack.
 * Used for integrity verification during audit.
 */
export function validateFrozenPolicy(
  frozen: FrozenPolicyReference,
  pack: BankPolicyPack,
): { valid: boolean; mismatches: string[] } {
  const mismatches: string[] = [];

  if (frozen.policy_hash !== pack.policy_hash) {
    mismatches.push(
      `Policy hash mismatch: frozen=${frozen.policy_hash.slice(0, 16)}… ` +
      `current=${pack.policy_hash.slice(0, 16)}…`,
    );
  }
  if (frozen.policy_version !== pack.policy_version) {
    mismatches.push(
      `Version mismatch: frozen=${frozen.policy_version} current=${pack.policy_version}`,
    );
  }
  if (frozen.rule_count !== pack.rules.length) {
    mismatches.push(
      `Rule count mismatch: frozen=${frozen.rule_count} current=${pack.rules.length}`,
    );
  }

  return { valid: mismatches.length === 0, mismatches };
}
