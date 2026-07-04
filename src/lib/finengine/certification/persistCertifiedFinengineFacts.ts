/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 24: Finengine Certification Writer.
 *
 * The ONLY gated canonical writer the finengine is permitted (safety rule 3).
 * It is DISABLED BY DEFAULT and CANNOT write unless ALL hold:
 *   1. the certification writer flag is explicitly enabled, AND
 *   2. the product's cutover flag is on (gate.cutoverAllowed), AND
 *   3. the product's reconciliation is clean (gate.reconciliationClean), AND
 *   4. a real writer function is injected.
 * Any failing precondition ⇒ every fact is SKIPPED with a reason and the injected
 * writer is never called.
 *
 * The actual DB write is INJECTED (`writer`) so this module is pure/testable and
 * so the caller owns the transaction + rollback. It returns the written keys for
 * rollback and a full write audit.
 */

export const CERTIFICATION_WRITER_ENV = "FINENGINE_CERTIFICATION_WRITER_ENABLED";
export const FINENGINE_CERTIFIED_EXTRACTOR = "finengine.certified.v1";

/** Is the certification writer enabled? DEFAULT FALSE. */
export function isCertificationWriterEnabled(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const raw = (env[CERTIFICATION_WRITER_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export type CertifiedFact = {
  factKey: string;
  value: number;
  product: string;
};

export type CertificationGate = {
  product: string;
  /** Product cutover flag is on. */
  cutoverAllowed: boolean;
  /** Product reconciliation has no UNEXPECTED divergence. */
  reconciliationClean: boolean;
};

export type ProvenanceStamp = {
  source_type: "FINENGINE_CERTIFIED";
  source_ref: string;
  extractor: string;
  as_of_date: string | null;
  /** Supersession policy marker: the prior producer this cert replaces. */
  supersedes: string;
};

/** Stable source_ref naming convention: finengine:certified:<product>. */
export function buildCertifiedSourceRef(product: string): string {
  return `finengine:certified:${product}`;
}

export function stampProvenance(product: string, asOf: string | null): ProvenanceStamp {
  return {
    source_type: "FINENGINE_CERTIFIED",
    source_ref: buildCertifiedSourceRef(product),
    extractor: FINENGINE_CERTIFIED_EXTRACTOR,
    as_of_date: asOf,
    // Supersession policy: a certified finengine fact supersedes ONLY the prior
    // finengine certified fact for the same key — never a live legacy fact
    // (legacy stays authoritative until the burn-down PR).
    supersedes: FINENGINE_CERTIFIED_EXTRACTOR,
  };
}

export type WriteAction = "written" | "skipped";
export type WriteAuditEntry = {
  factKey: string;
  action: WriteAction;
  reason: string;
};

export type CertificationResult = {
  enabled: boolean;
  wrote: boolean;
  audit: WriteAuditEntry[];
  /** Keys actually written — the rollback set. */
  writtenKeys: string[];
};

export type CertifiedWriter = (fact: CertifiedFact, provenance: ProvenanceStamp) => Promise<void>;

/**
 * Persist certified finengine facts through the gate. Disabled/blocked ⇒ nothing
 * is written and the injected writer is never invoked.
 */
export async function persistCertifiedFinengineFacts(args: {
  facts: CertifiedFact[];
  gate: CertificationGate;
  asOf?: string | null;
  writer?: CertifiedWriter;
  env?: Record<string, string | undefined>;
  /** Test/override hook; falls back to env. */
  enabledOverride?: boolean;
}): Promise<CertificationResult> {
  const enabled = args.enabledOverride ?? isCertificationWriterEnabled(args.env);

  // Determine a single blocking reason (checked in priority order).
  let blockReason: string | null = null;
  if (!enabled) blockReason = "writer_disabled";
  else if (!args.gate.cutoverAllowed) blockReason = "cutover_not_allowed";
  else if (!args.gate.reconciliationClean) blockReason = "reconciliation_blocked";
  else if (!args.writer) blockReason = "no_writer_injected_dry_run";

  if (blockReason) {
    return {
      enabled,
      wrote: false,
      audit: args.facts.map((f) => ({ factKey: f.factKey, action: "skipped", reason: blockReason! })),
      writtenKeys: [],
    };
  }

  const audit: WriteAuditEntry[] = [];
  const writtenKeys: string[] = [];
  const asOf = args.asOf ?? null;

  for (const fact of args.facts) {
    try {
      await args.writer!(fact, stampProvenance(fact.product, asOf));
      audit.push({ factKey: fact.factKey, action: "written", reason: "certified" });
      writtenKeys.push(fact.factKey);
    } catch (err: any) {
      // A failed write is surfaced (not swallowed); caller rolls back writtenKeys.
      audit.push({ factKey: fact.factKey, action: "skipped", reason: `write_error:${err?.message ?? String(err)}` });
    }
  }

  return { enabled, wrote: writtenKeys.length > 0, audit, writtenKeys };
}
