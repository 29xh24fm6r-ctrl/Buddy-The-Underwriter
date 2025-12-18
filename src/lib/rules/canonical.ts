import crypto from "node:crypto";

export type CanonicalRuleSet = {
  rule_set_key: string;
  version: string;
  fetched_at?: string;
  rules: {
    eligibility?: any[];
    ctc_defaults?: any[];
    doc_requirements?: any[];
    thresholds?: any[];
    [k: string]: any;
  };
};

function stableSortDeep(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stableSortDeep);
  if (obj && typeof obj === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(obj).sort()) out[k] = stableSortDeep(obj[k]);
    return out;
  }
  return obj;
}

export function canonicalizeRuleSet(input: CanonicalRuleSet) {
  const normalized = stableSortDeep({
    rule_set_key: input.rule_set_key,
    version: input.version,
    fetched_at: input.fetched_at ?? null,
    rules: input.rules ?? {},
  });

  const json = JSON.stringify(normalized);
  const hash = crypto.createHash("sha256").update(json).digest("hex");
  return { normalized, json, hash };
}

export type RuleDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  summary: string;
};

function keyForRule(rule: any) {
  // Deterministic "identity" for diffing. Prefer explicit ids if present.
  return rule?.id || rule?.code || rule?.name || JSON.stringify(rule);
}

export function diffRuleSets(prev: any, next: any): RuleDiff {
  const prevRules = prev?.rules ?? {};
  const nextRules = next?.rules ?? {};

  const buckets = new Set([...Object.keys(prevRules), ...Object.keys(nextRules)]);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const bucket of Array.from(buckets).sort()) {
    const a = Array.isArray(prevRules[bucket]) ? prevRules[bucket] : [];
    const b = Array.isArray(nextRules[bucket]) ? nextRules[bucket] : [];

    const mapA = new Map(a.map((r: any) => [keyForRule(r), JSON.stringify(r)]));
    const mapB = new Map(b.map((r: any) => [keyForRule(r), JSON.stringify(r)]));

    for (const k of mapB.keys()) if (!mapA.has(k)) added.push(`${bucket}:${k}`);
    for (const k of mapA.keys()) if (!mapB.has(k)) removed.push(`${bucket}:${k}`);
    for (const k of mapA.keys()) {
      if (mapB.has(k) && mapA.get(k) !== mapB.get(k)) changed.push(`${bucket}:${k}`);
    }
  }

  const summary =
    `Rules diff — added: ${added.length}, removed: ${removed.length}, changed: ${changed.length}.` +
    (changed.length ? " Review changes before applying." : "");

  return { added, removed, changed, summary };
}
