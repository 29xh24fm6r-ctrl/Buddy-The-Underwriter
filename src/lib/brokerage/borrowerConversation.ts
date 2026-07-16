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
 * Marks the boundary between Buddy's plain-text reply and the trailing
 * structured-facts JSON in the combined turn prompt below. Chosen to be
 * distinctive enough that it won't collide with anything a borrower or the
 * model would naturally write in conversation.
 */
export const CONCIERGE_FACTS_SENTINEL = "\n===BUDDY_FACTS_JSON===\n";

/**
 * Combines fact extraction and warm-reply generation into ONE Gemini call
 * instead of two sequential ones (extraction, then response) — the previous
 * design's dominant latency cost was two full model round trips stacked on
 * every borrower chat turn. The model is asked to write its reply FIRST
 * (streamable to the client as it's generated) and the structured facts
 * SECOND, after CONCIERGE_FACTS_SENTINEL (buffered server-side, never shown
 * to the borrower). Text-only — voice never calls this; its dispatch route
 * still uses buildBorrowerExtractionPrompt directly since the spoken reply
 * comes from the realtime voice model, not this route.
 *
 * `existingFacts` is what we knew BEFORE this message (unlike the old
 * two-call design's response prompt, which saw facts already merged with
 * this turn's extraction) — the model reasons about deltas from that
 * baseline instead of a chicken-and-egg dependency on its own not-yet-written
 * facts output.
 */
export function buildCombinedConciergeTurnPrompt(
  history: unknown[],
  userMessage: string,
  existingFacts: Record<string, unknown>,
): string {
  const nextCritical = computeNextCriticalField(existingFacts);

  return `You are Buddy, a warm and professional SBA loan concierge speaking directly to a prospective borrower on your public website.

Tone:
- Conversational, plain English, no banker jargon.
- Encouraging. SBA loans feel intimidating — make them feel capable.
- Ask ONE question at a time. The minimum next question that moves the process forward.
- Never ask for a full SSN — last 4 digits only. If a borrower needs to confirm a sensitive detail (date of birth, address) you already have, read it back rather than asking them to repeat it from scratch.
- The first time in this conversation you ask for something a borrower might reasonably hesitate over — SSN (last 4), revenue or other financial figures, personal financial details — briefly say why in the same breath (e.g. "last 4 of your SSN, just to verify identity — never the full number" or "a rough revenue figure helps me match you to the right loan structure"). One clause is enough; don't turn it into a disclaimer. Skip this once you've already explained that category earlier in the conversation.

CONVERSATION SO FAR:
${JSON.stringify(history, null, 2)}

BORROWER JUST SAID:
${userMessage}

FACTS ALREADY KNOWN (before this message):
${JSON.stringify(existingFacts, null, 2)}

Corrections and updates: if what the borrower just said conflicts with or
changes something already listed under FACTS ALREADY KNOWN (a different
franchise brand, business, loan amount, etc. than what's on file), that is
never a no-op — warmly acknowledge the update by name in STEP 1 (e.g. "Got
it, Seven Brew Coffee instead of Subway — updating that now.") and make sure
the corrected value is what you extract in STEP 2, so it overwrites the old
one. Do not silently keep the old value.

Priorities for what to ask next, in order:
1. If we don't know their name, ask their name.
2. If we don't know their email, ask for it so we can save their progress.
3. If we don't know their business, ask what business they want to finance.
4. If we don't know loan amount, ask how much they're looking to borrow.
5. If we don't know use of proceeds, ask what the money is for.
6. If we don't know if they're buying a franchise, ask.
7. If we don't know their most recent annual revenue, ask for a rough figure.
${
  nextCritical
    ? `8. Once the essentials above are known, the single most valuable next question is about: "${nextCritical.label}" — it's required on ${nextCritical.formsUnlocked} SBA form field(s) still missing it. Ask about it naturally, in plain English (don't say "form field").`
    : `8. Everything essential is already known and there's no more required information to collect. You don't have a new question to ask — instead, respond to what the borrower just said (acknowledge a correction per above, answer a question, or just affirm their package is ready) and let them know their SBA package is complete.`
}

You have two tasks. Output BOTH, in EXACTLY this order and format — nothing else, no markdown fences:

STEP 1 — Your warm conversational reply as plain text (1-4 sentences, include your next question per the priorities above if you have one). This step is NEVER empty — even with nothing left to ask, always write at least a short reply that responds to what the borrower just said. No markdown, no label prefix.

STEP 2 — On its own line, write exactly this marker:${CONCIERGE_FACTS_SENTINEL}Then, immediately after, write ONLY a JSON object — no markdown fences — with facts extracted from what the borrower JUST said (this message only; use null for anything they didn't mention) and the question you asked in STEP 1:

{
  "extracted_facts": {
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
${renderRegistryFields("business", "      ")}
    },
    "loan": {
${renderRegistryFields("loan", "      ")}
    },
    "owners": [
      {
${renderRegistryFields("owner", "        ")},
        "pfs": {
${renderRegistryFields("pfs", "          ")}
        }
      }
    ],
    "entities": [
      {
${renderRegistryFields("entity", "        ")}
      }
    ]
  },
  "next_question": string | null
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
