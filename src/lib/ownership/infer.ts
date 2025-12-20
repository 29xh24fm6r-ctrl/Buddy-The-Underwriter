// src/lib/ownership/infer.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Minimal stub:
 * - looks at existing OCR/classify results in your system (whatever table you already have)
 * - tries to find patterns like "Member: X 25%" or "Shareholder: X 30%"
 *
 * Return: suggested owners with confidence (banker-only)
 */
export async function inferOwnershipFromDocs(dealId: string) {
  const sb = supabaseAdmin();

  // TODO: adapt to your existing OCR/classification results table(s).
  // We'll do a best-effort search against any "document_results" style table if it exists.
  // If your schema differs, Cursor will map it; worst case, return empty.

  let textBlobs: string[] = [];
  try {
    const { data } = await sb
      .from("document_results")
      .select("text")
      .eq("deal_id", dealId)
      .limit(50);
    textBlobs = (data ?? []).map((r: any) => String(r.text ?? "")).filter(Boolean);
  } catch {
    // no-op
  }

  const joined = textBlobs.join("\n\n").slice(0, 250_000);
  if (!joined) return [];

  // Extremely simple pattern match. Real version will improve.
  const matches: Array<{ fullName: string; percent: number; confidence: number }> = [];

  const re = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s*(?:-|—|:)\s*(\d{1,3}(?:\.\d+)?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined))) {
    const fullName = m[1].trim();
    const percent = Number(m[2]);
    if (!fullName || !Number.isFinite(percent)) continue;
    if (percent <= 0 || percent > 100) continue;
    matches.push({ fullName, percent, confidence: 0.55 });
    if (matches.length >= 10) break;
  }

  return matches;
}
