/**
 * Generic Gemini JSON repair — conservative, syntax-only, never invents facts.
 *
 * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): only the `management`
 * BIE thread had a JSON-repair fallback (managementRepair.ts, built after a
 * real production incident — see its docstring). The other 5 grounded
 * threads (entity_lock, borrower, competitive, market, industry) had none:
 * any JSON parse failure — smart quotes, a trailing comma, an unescaped
 * newline the model commonly emits mid-prose — silently dropped the ENTIRE
 * thread's output (result: null), even though the same class of "useful
 * prose, malformed JSON" failure that prompted the management repair is not
 * specific to that one thread.
 *
 * Unlike managementRepair.ts, this does NOT normalize to a specific business
 * shape (there's no equivalent "never invent a principal" semantic to
 * enforce for e.g. IndustryIntelligence) — it only recovers valid JSON
 * syntax and returns the parsed object AS the caller's target type, exactly
 * like the unrepaired path's `JSON.parse(clean) as T` already does.
 */

export const GENERIC_JSON_REPAIR_STRATEGY = "generic_json_repair";

/** Extract the largest top-level balanced `{...}` substring, or null. */
function extractLargestJsonObject(text: string): string | null {
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
 * Conservative, lossless-where-possible JSON repair.
 *
 * Applies a fixed batch of structural fixes (extract largest balanced
 * object, smart-quote normalization, trailing-comma removal) and re-parses.
 * Returns null when no valid JSON object can be recovered — the caller's
 * existing "thread returned null" handling takes over exactly as before.
 */
export function repairGenericJson<T>(rawClean: string): T | null {
  if (!rawClean || rawClean.trim().length === 0) return null;

  const candidate = extractLargestJsonObject(rawClean) ?? rawClean.trim();

  const repaired = candidate
    // Smart quotes → straight quotes
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // Trailing commas before a closing brace/bracket
    .replace(/,\s*([}\]])/g, "$1");

  try {
    const parsed = JSON.parse(repaired);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}
