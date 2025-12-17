// src/lib/finance/tax/labelExtract.ts

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,]/g, "").trim();
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Walks unknown JSON and returns a list of "candidate strings" (bounded).
 * Used for label scans in messy model outputs.
 */
export function flattenStrings(raw: unknown, limit = 8000): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const stack: unknown[] = [raw];

  while (stack.length && out.length < limit) {
    const node = stack.pop();
    if (!node) continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (typeof node === "string") {
      out.push(node);
      continue;
    }
    if (typeof node === "number") {
      out.push(String(node));
      continue;
    }
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    if (isRecord(node)) {
      for (const k of Object.keys(node)) stack.push(node[k]);
    }
  }

  return out;
}

/**
 * Looks for patterns like "Compensation of officers .... 123,456"
 * Returns the first reasonable match.
 */
export function findLabeledAmount(
  flat: string[],
  labelRegex: RegExp
): { value: number | null; evidence?: string } {
  for (const s of flat) {
    if (!labelRegex.test(s)) continue;

    // Try to find a number within the same string
    const m = s.match(/(-?\$?\s*\d[\d,]*\.?\d*)\b/);
    const v = m?.[1] ? pickNumber(m[1]) : null;
    if (v !== null) return { value: v, evidence: s.slice(0, 120) };
  }
  return { value: null };
}