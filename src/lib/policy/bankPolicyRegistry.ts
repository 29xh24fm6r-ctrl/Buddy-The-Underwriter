/**
 * Bank-Scoped Policy Registry (Phase J)
 *
 * Manages bank-specific credit policy packs — versioned, immutable
 * once active, and scoped to individual banks. This ensures that
 * multi-bank environments resolve the correct policy at decision time.
 *
 * Invariants:
 *  - Policies are bank-scoped (Bank A cannot see Bank B's policy)
 *  - Active policies are immutable (create new version to change)
 *  - Policy hash is frozen in decision snapshots at decision time
 *  - Every rule has a severity: "hard" blocks decisions, "soft" warns
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/security/tokens";

// ── Types ──────────────────────────────────────────────

export type BankPolicyRule = {
  rule_id: string;
  description: string;
  threshold: unknown;
  severity: "hard" | "soft";
};

export type BankPolicyPack = {
  bank_id: string;
  policy_id: string;
  policy_version: string;
  effective_at: string;
  supersedes: string | null;
  rules: BankPolicyRule[];
  policy_hash: string;
  created_at: string;
};

export type BankPolicyPackSummary = {
  bank_id: string;
  policy_id: string;
  policy_version: string;
  effective_at: string;
  rule_count: number;
  hard_rules: number;
  soft_rules: number;
  policy_hash: string;
};

// ── Builders ───────────────────────────────────────────

/**
 * Build a BankPolicyPack from raw DB row + rules.
 * Computes a deterministic policy_hash for snapshot freezing.
 */
export function buildPolicyPack(args: {
  bank_id: string;
  policy_id: string;
  policy_version: string;
  effective_at: string;
  supersedes?: string | null;
  rules: BankPolicyRule[];
  created_at: string;
}): BankPolicyPack {
  const hashInput = JSON.stringify({
    bank_id: args.bank_id,
    policy_id: args.policy_id,
    policy_version: args.policy_version,
    rules: args.rules
      .slice()
      .sort((a, b) => a.rule_id.localeCompare(b.rule_id))
      .map((r) => ({
        rule_id: r.rule_id,
        description: r.description,
        threshold: r.threshold,
        severity: r.severity,
      })),
  });

  return {
    bank_id: args.bank_id,
    policy_id: args.policy_id,
    policy_version: args.policy_version,
    effective_at: args.effective_at,
    supersedes: args.supersedes ?? null,
    rules: args.rules,
    policy_hash: sha256(hashInput),
    created_at: args.created_at,
  };
}

/**
 * Summarize a policy pack (no rules, just counts).
 */
export function summarizePolicyPack(pack: BankPolicyPack): BankPolicyPackSummary {
  return {
    bank_id: pack.bank_id,
    policy_id: pack.policy_id,
    policy_version: pack.policy_version,
    effective_at: pack.effective_at,
    rule_count: pack.rules.length,
    hard_rules: pack.rules.filter((r) => r.severity === "hard").length,
    soft_rules: pack.rules.filter((r) => r.severity === "soft").length,
    policy_hash: pack.policy_hash,
  };
}

// ── DB Queries ─────────────────────────────────────────

/**
 * Get the active policy pack for a bank as of a given time.
 * If no effective_at is provided, returns the most recent active pack.
 */
export async function getActivePolicyPack(
  bankId: string,
  effectiveAt?: string,
): Promise<BankPolicyPack | null> {
  const sb = supabaseAdmin();

  let q = sb
    .from("bank_policy_packs")
    .select("*")
    .eq("bank_id", bankId)
    .eq("active", true)
    .order("effective_at", { ascending: false })
    .limit(1);

  if (effectiveAt) {
    q = q.lte("effective_at", effectiveAt);
  }

  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;

  const raw = data as any;
  return buildPolicyPack({
    bank_id: raw.bank_id,
    policy_id: raw.id,
    policy_version: raw.policy_version ?? "1.0",
    effective_at: raw.effective_at ?? raw.created_at,
    supersedes: raw.supersedes_id ?? null,
    rules: Array.isArray(raw.rules_json) ? raw.rules_json : [],
    created_at: raw.created_at,
  });
}

/**
 * Get all policy pack versions for a bank (for audit history).
 */
export async function getPolicyPackHistory(
  bankId: string,
  limit: number = 20,
): Promise<BankPolicyPackSummary[]> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bank_policy_packs")
    .select("*")
    .eq("bank_id", bankId)
    .order("effective_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as any[]).map((raw) => {
    const pack = buildPolicyPack({
      bank_id: raw.bank_id,
      policy_id: raw.id,
      policy_version: raw.policy_version ?? "1.0",
      effective_at: raw.effective_at ?? raw.created_at,
      supersedes: raw.supersedes_id ?? null,
      rules: Array.isArray(raw.rules_json) ? raw.rules_json : [],
      created_at: raw.created_at,
    });
    return summarizePolicyPack(pack);
  });
}

/**
 * Compare two bank policy packs to find rule differences.
 */
export function diffPolicyPacks(
  packA: BankPolicyPack,
  packB: BankPolicyPack,
): PolicyPackDiff {
  const rulesA = new Map(packA.rules.map((r) => [r.rule_id, r]));
  const rulesB = new Map(packB.rules.map((r) => [r.rule_id, r]));

  const onlyInA: BankPolicyRule[] = [];
  const onlyInB: BankPolicyRule[] = [];
  const changed: Array<{ rule_id: string; bank_a: BankPolicyRule; bank_b: BankPolicyRule }> = [];
  const identical: string[] = [];

  for (const [id, ruleA] of rulesA) {
    const ruleB = rulesB.get(id);
    if (!ruleB) {
      onlyInA.push(ruleA);
    } else if (
      JSON.stringify(ruleA.threshold) !== JSON.stringify(ruleB.threshold) ||
      ruleA.severity !== ruleB.severity
    ) {
      changed.push({ rule_id: id, bank_a: ruleA, bank_b: ruleB });
    } else {
      identical.push(id);
    }
  }

  for (const [id, ruleB] of rulesB) {
    if (!rulesA.has(id)) {
      onlyInB.push(ruleB);
    }
  }

  return {
    bank_a_id: packA.bank_id,
    bank_b_id: packB.bank_id,
    bank_a_version: packA.policy_version,
    bank_b_version: packB.policy_version,
    only_in_a: onlyInA,
    only_in_b: onlyInB,
    changed,
    identical_count: identical.length,
    total_rules_a: packA.rules.length,
    total_rules_b: packB.rules.length,
  };
}

export type PolicyPackDiff = {
  bank_a_id: string;
  bank_b_id: string;
  bank_a_version: string;
  bank_b_version: string;
  only_in_a: BankPolicyRule[];
  only_in_b: BankPolicyRule[];
  changed: Array<{ rule_id: string; bank_a: BankPolicyRule; bank_b: BankPolicyRule }>;
  identical_count: number;
  total_rules_a: number;
  total_rules_b: number;
};
