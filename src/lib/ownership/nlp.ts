// src/lib/ownership/nlp.ts

/**
 * Parse borrower correction text into structured owners.
 * Examples:
 * - "Matt 55, John 25, Sarah 20"
 * - "Me 60% John Smith 25% Sarah 15%"
 * - "Two owners: Matt 50/50 with John"
 */
export function parseOwnershipText(input: string): Array<{ fullName: string; ownershipPercent: number | null; email?: string | null }> {
  const text = (input || "").trim();
  if (!text) return [];

  // 1) split by commas/semicolons/newlines
  const parts = text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: Array<{ fullName: string; ownershipPercent: number | null; email?: string | null }> = [];

  // pattern: "Name 25" or "Name 25%"
  const re = /^(.+?)\s+(\d{1,3}(?:\.\d+)?)\s*%?$/;

  for (const p of parts) {
    const m = p.match(re);
    if (m) {
      const name = m[1].trim();
      const pct = Number(m[2]);
      if (name && Number.isFinite(pct) && pct >= 0 && pct <= 100) {
        out.push({ fullName: name, ownershipPercent: pct });
        continue;
      }
    }

    // pattern: "email in text"
    const emailMatch = p.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch) {
      out.push({ fullName: p.replace(emailMatch[0], "").trim() || "Owner", ownershipPercent: null, email: emailMatch[0] });
      continue;
    }

    // fallback: treat as name w/ unknown percent
    out.push({ fullName: p, ownershipPercent: null });
  }

  return out.slice(0, 12);
}
