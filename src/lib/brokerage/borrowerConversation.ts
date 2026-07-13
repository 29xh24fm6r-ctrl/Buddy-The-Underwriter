import "server-only";

/**
 * Shared conversation logic for Arc 7 — both the text concierge
 * (/api/brokerage/concierge) and voice dispatch
 * (/api/brokerage/voice/[sessionId]/dispatch) use the exact same
 * extraction prompt, merge behavior, and "what should Buddy ask next"
 * ranker, so a borrower gets the same coverage regardless of channel.
 * Registry-driven (src/lib/sba/forms/borrowerFieldRegistry.ts) — extending
 * SBA form coverage means adding a registry row, not editing this file.
 */

import {
  BORROWER_FIELD_REGISTRY,
  factKey,
  fieldsForScope,
  type BorrowerFieldEntry,
} from "@/lib/sba/forms/borrowerFieldRegistry";
import { computeApplicableForms } from "@/lib/sba/forms/applicability";

function jsonTypeHint(entry: BorrowerFieldEntry): string {
  if (entry.type === "number") return "number | null";
  if (entry.type === "boolean") return "boolean | null";
  if (entry.type === "date") return "string (YYYY-MM-DD) | null";
  return "string | null";
}

function renderRegistryFields(scope: "business" | "owner" | "entity" | "loan" | "pfs", indent: string): string {
  return fieldsForScope(scope)
    .map((e) => `${indent}"${factKey(e)}": ${jsonTypeHint(e)}`)
    .join(",\n");
}

/**
 * Extracts structured facts from a borrower message/utterance. Same shape
 * for text and voice: {borrower, business, loan, owners[], entities[]}.
 * SSN is intentionally last-4 only — never asks for or records a full SSN.
 */
export function buildBorrowerExtractionPrompt(
  history: unknown[],
  userMessage: string,
): string {
  return `Extract structured facts from the borrower's latest message, given the conversation history.

CONVERSATION HISTORY:
${JSON.stringify(history, null, 2)}

BORROWER JUST SAID:
${userMessage}

Extract facts in this JSON structure. Use null for unknown values. Only include an entry in "owners" or "entities" when the borrower has told you something specific about that person/entity — do not invent placeholder entries. SSN is last 4 digits only; never ask for or record a full SSN. Return ONLY the JSON.

{
  "borrower": {
    "first_name": string | null,
    "last_name": string | null,
    "email": string | null,
    "phone": string | null
  },
  "business": {
    "industry_description": string | null,
    "is_startup": boolean | null,
    "years_in_business": number | null,
    "annual_revenue": number | null,
    "is_franchise": boolean | null,
    "franchise_brand": string | null,
${renderRegistryFields("business", "    ")}
  },
  "loan": {
${renderRegistryFields("loan", "    ")}
  },
  "owners": [
    {
${renderRegistryFields("owner", "      ")},
      "pfs": {
${renderRegistryFields("pfs", "        ")}
      }
    }
  ],
  "entities": [
    {
${renderRegistryFields("entity", "      ")}
    }
  ]
}`;
}

/**
 * Highest-impact still-missing registry field across whatever SBA forms
 * this deal's known facts make applicable — generalizes the ruleEngine's
 * getNextCriticalFact idea (see the deprecated /api/borrower/concierge
 * route) off the full field registry instead of a small policy-rule set.
 * Only considers the first owner in facts.owners[] so a response doesn't
 * interleave multiple people's questions in one turn.
 */
export function computeNextCriticalField(
  facts: Record<string, any>,
): { label: string; formsUnlocked: number } | null {
  const owners = Array.isArray(facts?.owners) ? (facts.owners as Record<string, unknown>[]) : [];
  const applicable = computeApplicableForms({
    program: "7a",
    hasIndividualOwner: owners.length > 0,
    hasEquityOwningEntity: Array.isArray(facts?.entities) && facts.entities.length > 0,
    sellerNoteEquityPortion: null,
    constructionAmount: null,
  });

  const isPresent = (v: unknown) => v != null && v !== "";
  const impact = new Map<string, { count: number; label: string }>();

  function consider(entry: (typeof BORROWER_FIELD_REGISTRY)[number], bag: Record<string, unknown>) {
    const relevantForms = entry.requiredForForms.filter((f) => applicable.includes(f));
    if (relevantForms.length === 0 || isPresent(bag[factKey(entry)])) return;
    const existing = impact.get(entry.key);
    impact.set(entry.key, { count: (existing?.count ?? 0) + relevantForms.length, label: entry.label });
  }

  for (const entry of fieldsForScope("business")) consider(entry, facts?.business ?? {});
  for (const entry of fieldsForScope("loan")) consider(entry, facts?.loan ?? {});
  if (owners.length > 0) {
    const firstOwner = owners[0];
    for (const entry of fieldsForScope("owner")) consider(entry, firstOwner);
    for (const entry of fieldsForScope("pfs")) consider(entry, (firstOwner["pfs"] as Record<string, unknown>) ?? {});
  }

  let best: { count: number; label: string } | null = null;
  for (const v of impact.values()) {
    if (!best || v.count > best.count) best = v;
  }
  return best ? { label: best.label, formsUnlocked: best.count } : null;
}

export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMerge(
        (a?.[k] as Record<string, unknown>) ?? {},
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Merges an array of {matchKey: value, ...} objects by matchKey — later turns update the matched entry in place instead of replacing the whole array. */
function mergeFactArray(
  existing: unknown,
  incoming: unknown,
  matchKey: string,
): Array<Record<string, unknown>> {
  const existingArr = Array.isArray(existing) ? (existing as Array<Record<string, unknown>>) : [];
  const incomingArr = Array.isArray(incoming) ? (incoming as Array<Record<string, unknown>>) : [];
  if (incomingArr.length === 0) return existingArr;

  const merged = [...existingArr];
  for (const item of incomingArr) {
    if (typeof item !== "object" || item === null) continue;
    const key = (item as Record<string, unknown>)[matchKey];
    const idx = key ? merged.findIndex((m) => m?.[matchKey] === key) : -1;
    if (idx >= 0) {
      merged[idx] = deepMerge(merged[idx], item);
    } else {
      merged.push(item);
    }
  }
  return merged;
}

/**
 * Top-level fact merge shared by text and voice. Delegates scalar/nested-
 * object merging to deepMerge, but owners[]/entities[] need array-aware
 * merging by name — otherwise a later turn that only mentions one owner
 * would silently drop every other owner deepMerge's plain array
 * replacement already collected.
 */
export function mergeExtractedFacts(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = deepMerge(existing, incoming);
  merged.owners = mergeFactArray(existing?.owners, incoming?.owners, "full_name");
  merged.entities = mergeFactArray(existing?.entities, incoming?.entities, "legal_name");
  return merged;
}
