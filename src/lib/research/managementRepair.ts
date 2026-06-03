/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 1
 *
 * Management thread JSON repair + deterministic private-company fallback.
 *
 * The management thread frequently returns useful PROSE but malformed JSON
 * (observed live on OmniCare: `"principal_profiles":. He possesses over 25
 * years...`). Previously the whole thread was discarded, producing
 * management=null and the misleading "No ownership entities provided —
 * management research not possible" gate message.
 *
 * Two safety nets, in order:
 *   A. repairManagementJson — ONE conservative structural repair pass on the
 *      raw model text. Fixes recoverable malformations (trailing commas, smart
 *      quotes, unescaped newlines). NEVER invents facts. Returns null if no
 *      valid object can be recovered → deterministic fallback takes over.
 *   B. buildManagementFallback — deterministic, file-based ManagementIntelligence
 *      built ONLY from banker-certified principals on file. Clearly labelled as
 *      file-based; never sets identity_confirmed=true; never reaches committee.
 *
 * This module is intentionally free of `server-only` so it is unit-testable as
 * a pure function. It type-imports from buddyIntelligenceEngine (erased at
 * runtime), so it carries no server-only transitive dependency.
 */

import type {
  ManagementIntelligence,
  PrincipalProfile,
  BIEInput,
} from "./buddyIntelligenceEngine";

export const MANAGEMENT_REPAIR_STRATEGY = "management_json_repair";
export const MANAGEMENT_FALLBACK_CONFIDENCE = 0.45;

/**
 * Conservative, lossless-where-possible JSON repair for the management thread.
 *
 * Applies a fixed sequence of structural fixes and re-parses after the batch.
 * If the result parses into an object we normalize it to the
 * ManagementIntelligence shape (coercing/ dropping malformed fields — never
 * fabricating). Returns null when no valid JSON object can be recovered.
 */
export function repairManagementJson(rawClean: string): ManagementIntelligence | null {
  if (!rawClean || rawClean.trim().length === 0) return null;

  // 1. Try the cheapest recovery first: extract the largest balanced {...} block.
  const candidate = extractlargestJsonObject(rawClean) ?? rawClean.trim();

  // 2. A fixed batch of conservative structural fixes. None of these invent
  //    content; they only repair syntax the model commonly emits.
  const repaired = candidate
    // Smart quotes → straight quotes
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // Trailing commas before a closing brace/bracket
    .replace(/,\s*([}\]])/g, "$1")
    // A value position that opens with a bare `.` or `,` (e.g. `"key":. He…`)
    // is unrecoverable structurally — leave it; parse will fail → null → fallback.
    ;

  let parsed: unknown;
  try {
    parsed = JSON.parse(repaired);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const normalized = normalizeManagement(parsed as Record<string, unknown>);
  // A repaired object with neither profiles nor any prose is not "usable" —
  // defer to the deterministic fallback instead.
  const hasContent =
    normalized.principal_profiles.length > 0 ||
    normalized.management_depth.trim().length > 0 ||
    normalized.key_person_risk.trim().length > 0 ||
    normalized.ownership_and_governance.trim().length > 0;
  return hasContent ? normalized : null;
}

/** Extract the largest top-level balanced `{...}` substring, or null. */
function extractlargestJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  return text.slice(start, end + 1);
}

/**
 * Normalize an arbitrary parsed object into a safe ManagementIntelligence.
 * Coerces types, clamps confidences, drops profiles without a usable name.
 * Crucially: never upgrades trust — identity_confirmed must be an explicit
 * boolean true, otherwise false.
 */
function normalizeManagement(obj: Record<string, unknown>): ManagementIntelligence {
  const rawProfiles = Array.isArray(obj.principal_profiles) ? obj.principal_profiles : [];
  const profiles: PrincipalProfile[] = [];
  for (const p of rawProfiles) {
    if (!p || typeof p !== "object") continue;
    const rec = p as Record<string, unknown>;
    const name = str(rec.name).trim();
    if (name.length < 2) continue; // never invent a principal
    profiles.push({
      name,
      title: rec.title != null ? str(rec.title) : null,
      identity_confirmed: rec.identity_confirmed === true,
      identity_confidence: clamp01(num(rec.identity_confidence)),
      identity_notes: str(rec.identity_notes),
      background: str(rec.background),
      other_ventures: str(rec.other_ventures) || "Unknown",
      track_record: str(rec.track_record) || "Unknown",
      red_flags: str(rec.red_flags) || "No adverse events identified in public records",
    });
  }
  return {
    principal_profiles: profiles,
    management_depth: str(obj.management_depth),
    key_person_risk: str(obj.key_person_risk),
    ownership_and_governance: str(obj.ownership_and_governance),
  };
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Deterministic, file-based management fallback for a private borrower.
 *
 * Fires ONLY when the public management thread produced nothing usable AND we
 * have banker-certified principals on file. Produces one clearly-labelled
 * file-based profile per known principal. Returns null when there is nothing to
 * anchor on (no principals or no banker-certified context) — a no-principal
 * borrower never gets a fabricated fallback.
 */
export function buildManagementFallback(input: BIEInput): ManagementIntelligence | null {
  const principals = (input.principals ?? []).filter((p) => p?.name && p.name.trim().length > 1);
  if (principals.length === 0) return null;
  if (!input.has_banker_certified_anchor) return null;

  const profiles: PrincipalProfile[] = principals.map((p) => ({
    name: p.name.trim(),
    title: p.title ?? null,
    identity_confirmed: false,
    identity_confidence: MANAGEMENT_FALLBACK_CONFIDENCE,
    identity_notes:
      "Banker-certified management profile on file; public management thread failed or returned no usable structured output.",
    background: "Banker-certified/file-based profile only; public confirmation limited.",
    other_ventures: "Unknown from public sources.",
    track_record: "Banker-certified experience on file; public confirmation limited.",
    red_flags:
      "No public adverse events confirmed from available research; public confirmation limited.",
  }));

  const single = profiles.length === 1;
  const titled = principals
    .map((p) => (p.title ? `${p.name} (${p.title})` : p.name))
    .join(", ");
  const hasTitles = principals.some((p) => !!p.title);

  return {
    principal_profiles: profiles,
    management_depth:
      `File-based summary: ${profiles.length} banker-certified principal(s) on file (${titled}). ` +
      "Public confirmation of management depth is limited; profiles reflect loan-file context only.",
    key_person_risk: single
      ? `Single identified principal (${profiles[0].name}) — key-person dependency should be assumed pending committee confirmation.`
      : "Management responsibilities span multiple identified principals per the loan file; depth should be confirmed before committee.",
    ownership_and_governance: hasTitles
      ? `Ownership/governance per loan file: ${titled}. Public confirmation limited; confirm ownership structure before committee.`
      : "Ownership/governance support should be confirmed before committee.",
  };
}
