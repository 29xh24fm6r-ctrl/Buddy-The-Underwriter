/**
 * Pure document-validity / type-compatibility helpers for checklist satisfaction.
 *
 * PURITY NOTE: This module MUST NOT import "server-only" or anything that
 * transitively pulls it (supabaseAdmin, writeEvent, …). It is consumed both by
 * the server-only checklist engine AND by CI unit tests under node:test. The
 * engine.ts barrel pulls server-only deps and therefore cannot be imported in a
 * plain node test — so the deterministic decision logic lives here instead.
 *
 * SPEC-CHECKLIST-DOCUMENT-SATISFACTION-RECONCILIATION-1.
 */

export type CanonicalDocTypeBucket =
  | "business_tax_return"
  | "personal_tax_return"
  | "income_statement"
  | "balance_sheet"
  | "financial_statement";

export function acceptableDocTypesForChecklistKey(
  checklistKeyRaw: string,
): CanonicalDocTypeBucket[] | null {
  const key = String(checklistKeyRaw || "").toUpperCase();
  if (!key) return null;

  // PTR with Schedule C can satisfy BTR requirement (sole proprietors)
  if (key.startsWith("IRS_BUSINESS")) return ["business_tax_return", "personal_tax_return"];
  if (key.startsWith("IRS_PERSONAL")) return ["personal_tax_return"];

  if (key === "FIN_STMT_PL_YTD") return ["income_statement", "financial_statement"];
  if (key === "FIN_STMT_PL_ANNUAL") return ["income_statement", "financial_statement"];
  if (key === "FIN_STMT_BS_YTD") return ["balance_sheet", "financial_statement"];
  if (key === "FIN_STMT_BS_CURRENT") return ["balance_sheet", "financial_statement"];
  if (key === "FIN_STMT_BS_HISTORICAL") return ["balance_sheet", "financial_statement"];
  // Back-compat legacy key (older deals): treat as requiring either statement.
  if (key === "FIN_STMT_YTD") return ["income_statement", "balance_sheet", "financial_statement"];

  return null;
}

export function normalizeDocIntelDocTypeToCanonicalBucket(
  docTypeRaw: unknown,
): CanonicalDocTypeBucket | null {
  const raw = String(docTypeRaw ?? "").trim();
  if (!raw) return null;

  // Canonical values (preferred)
  if (raw === "business_tax_return") return "business_tax_return";
  if (raw === "personal_tax_return") return "personal_tax_return";
  if (raw === "income_statement") return "income_statement";
  if (raw === "balance_sheet") return "balance_sheet";
  if (raw === "financial_statement") return "financial_statement";

  // Tolerate older / alternate doc_type strings (e.g. OpenAI/legacy)
  // Normalize to a token soup.
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const has = (t: string) => s.includes(t);

  const looksIncome =
    has("income_statement") ||
    has("profit_and_loss") ||
    has("profit_loss") ||
    has("p_l") ||
    has("pl") ||
    has("statement_of_operations") ||
    has("statement_of_income");

  const looksBalance =
    has("balance_sheet") ||
    has("statement_of_financial_position") ||
    has("financial_position");

  if (looksIncome && looksBalance) return "financial_statement";
  if (looksIncome) return "income_statement";
  if (looksBalance) return "balance_sheet";

  // Tax returns: accept both descriptive types and form codes.
  if (has("business") && has("tax")) return "business_tax_return";
  if (has("personal") && has("tax")) return "personal_tax_return";

  // Form tokens seen in the wild.
  if (/(^|_)irs_?(1120s|1120|1065)(_|$)/.test(s) || /(^|_)1120s?(_|$)/.test(s) || /(^|_)1065(_|$)/.test(s)) {
    return "business_tax_return";
  }
  if (/(^|_)irs_?1040(_|$)/.test(s) || /(^|_)1040(_|$)/.test(s)) {
    return "personal_tax_return";
  }

  // If doc type is too broad, ignore it.
  if (has("unknown") || has("other") || has("document")) return null;

  return null;
}

// ─── Validity / compatibility for checklist satisfaction ────────────────────

/**
 * Quality statuses that mean the document FAILED extraction/QA and must never
 * satisfy a required checklist item. Unknown/empty/PASSED statuses are treated
 * as acceptable so older environments (no quality_status column) are not blocked.
 */
const FAILED_QUALITY_STATUSES = new Set([
  "FAILED",
  "REJECTED",
  "QUALITY_FAILED",
  "ERROR",
  "SUPERSEDED",
]);

/** A minimal document shape — only the fields satisfaction needs. */
export type ChecklistCandidateDoc = {
  id?: string | null;
  checklist_key?: string | null;
  canonical_type?: string | null;
  document_type?: string | null;
  quality_status?: string | null;
  is_active?: boolean | null;
  finalized_at?: string | null;
};

/**
 * A document is "live" for satisfaction when it is active and not in a failed /
 * rejected / superseded quality state. Missing fields are tolerated (older envs)
 * — only an EXPLICIT inactive flag or EXPLICIT failure status disqualifies it.
 */
export function isDocActiveAndQualityOk(d: ChecklistCandidateDoc): boolean {
  if (d?.is_active === false) return false;
  const q = String(d?.quality_status ?? "").trim().toUpperCase();
  if (q && FAILED_QUALITY_STATUSES.has(q)) return false;
  return true;
}

/**
 * Does this document's type satisfy the given checklist key? Pure type/key
 * compatibility only — does NOT consider quality/active (see isDocValidForChecklistKey).
 */
export function docMatchesChecklistKey(d: ChecklistCandidateDoc, itemKey: string): boolean {
  const key = String(itemKey || "").trim();
  if (!key) return false;

  // Direct, already-stamped checklist_key wins.
  if (String(d?.checklist_key ?? "").trim() === key) return true;

  // PFS: canonical/document type carries the signal even when checklist_key is null.
  if (key === "PFS_CURRENT") {
    const ct = String(d?.canonical_type ?? "").trim().toUpperCase();
    if (ct === "PFS" || ct === "PERSONAL_FINANCIAL_STATEMENT") return true;
    const dt = String(d?.document_type ?? "").trim().toUpperCase();
    if (dt === "PFS" || dt === "PERSONAL_FINANCIAL_STATEMENT") return true;
    return false;
  }

  // Year / statement items: compatibility via canonical doc-type buckets.
  const acceptable = acceptableDocTypesForChecklistKey(key);
  if (acceptable) {
    const bucket =
      normalizeDocIntelDocTypeToCanonicalBucket(d?.document_type) ??
      normalizeDocIntelDocTypeToCanonicalBucket(d?.canonical_type);
    if (bucket && acceptable.includes(bucket)) return true;
  }

  return false;
}

/**
 * The single deterministic predicate for "may this document satisfy this required
 * checklist key?": it must be type-compatible AND active/quality-ok. Used for both
 * the PFS_CURRENT fallback and the received_document_id self-heal.
 *
 * NOTE: this intentionally does NOT short-circuit year-count requirements — callers
 * still apply year-based satisfaction (e.g. IRS_*_3Y) on top of this gate.
 */
export function isDocValidForChecklistKey(d: ChecklistCandidateDoc, itemKey: string): boolean {
  return isDocActiveAndQualityOk(d) && docMatchesChecklistKey(d, itemKey);
}
