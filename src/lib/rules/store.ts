import { supabaseAdmin } from "@/lib/supabase/admin";
import { canonicalizeRuleSet, diffRuleSets, CanonicalRuleSet } from "./canonical";

export async function ensureRuleSet(rule_set_key: string, name?: string, description?: string) {
  const { data: existing, error: e1 } = await supabaseAdmin()
    .from("rule_sets")
    .select("*")
    .eq("rule_set_key", rule_set_key)
    .maybeSingle() as any;

  if (e1) throw e1;
  if (existing) return existing;

  const { data: inserted, error: e2 } = await supabaseAdmin()
    .from("rule_sets")
    .insert({
      rule_set_key,
      name: name ?? rule_set_key,
      description: description ?? null,
      active: true,
    } as any)
    .select("*")
    .single() as any;

  if (e2) throw e2;
  return inserted;
}

export async function getLatestRuleVersion(rule_set_key: string) {
  const rs = await ensureRuleSet(rule_set_key);

  const { data, error } = await supabaseAdmin()
    .from("rule_set_versions")
    .select("*")
    .eq("rule_set_id", rs.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle() as any;

  if (error) throw error;
  return { ruleSet: rs, latest: data ?? null };
}

export async function upsertNewRuleVersion(input: CanonicalRuleSet) {
  const rs = await ensureRuleSet(input.rule_set_key);

  const { normalized, hash } = canonicalizeRuleSet(input);
  const { latest } = await getLatestRuleVersion(input.rule_set_key);

  if (latest?.content_hash === hash) {
    return { created: false, versionRow: latest, change_summary: latest.change_summary ?? "No change" };
  }

  const change_summary = latest
    ? diffRuleSets(latest.rules_json, normalized).summary
    : "Initial rule set version.";

  const { data: inserted, error } = await supabaseAdmin()
    .from("rule_set_versions")
    .insert({
      rule_set_id: rs.id,
      version: input.version,
      fetched_at: input.fetched_at ?? new Date().toISOString(),
      content_hash: hash,
      rules_json: normalized,
      change_summary,
    } as any)
    .select("*")
    .single() as any;

  if (error) throw error;

  return { created: true, versionRow: inserted, change_summary };
}
