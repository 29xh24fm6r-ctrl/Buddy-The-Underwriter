import "server-only";

/**
 * SPEC-M4 FIX-CARDS-1 — "why a lender cares" copy, cached per issue_type
 * (not per deal). First instance of this cache pattern in the repo — see
 * fix_card_copy_cache migration.
 *
 * Generator-only, no verifier pass: unlike SPEC-M3's Glass Box (which
 * narrates specific deal figures verifyClaims can fact-check against),
 * this copy is deliberately generic category-level education ("why does a
 * lender care about DSCR in general") with no deal-specific numbers to
 * verify against — there's no ground truth for a verifier to check a
 * generic statement against. The system prompt itself constrains the
 * output to stay generic and safe.
 *
 * npiTagged: false — this prompt never contains borrower financial data,
 * only an issue-type category name and one illustrative (already-generic)
 * example summary, so it isn't gated behind the Anthropic vendor-doc
 * approval the way SPEC-M3's narration is.
 */

import { runRole } from "./gateway";

type SB = { from: (t: string) => any };

const GENERATOR_SYSTEM_INSTRUCTION =
  "You write short, reusable explanations of why a specific type of loan- " +
  "application issue matters to a lender. This copy will be shown to many " +
  "different borrowers who hit the same category of issue, so write " +
  "generically — never reference a specific person, business, or number. " +
  "One or two plain-English sentences, no jargon, no alarming language, " +
  "no statement about whether a loan will or won't be approved.";

const FALLBACK_COPY =
  "Lenders review this to confirm your application accurately reflects your business's financial position.";

function buildPrompt(issueType: string, exampleSummary: string): string {
  return [
    `Issue category: ${issueType}`,
    `One example instance of this category: ${exampleSummary}`,
    "",
    "Write 1-2 sentences explaining why a lender generally cares about this category of issue.",
  ].join("\n");
}

/**
 * Returns cached copy for issueType if present; otherwise generates,
 * caches, and returns it. Never throws — falls back to generic copy on
 * any failure so a fix card always has something to show.
 */
export async function getOrGenerateFixCardCopy(
  issueType: string,
  exampleSummary: string,
  sb: SB,
): Promise<string> {
  const { data: cached } = await sb
    .from("fix_card_copy_cache")
    .select("copy")
    .eq("issue_type", issueType)
    .maybeSingle();

  if (cached?.copy) return cached.copy;

  try {
    const result = await runRole("generator", {
      prompt: buildPrompt(issueType, exampleSummary),
      systemInstruction: GENERATOR_SYSTEM_INSTRUCTION,
      purpose: "fix_card_copy",
      npiTagged: false,
    });

    const copy = result.text.trim() || FALLBACK_COPY;

    await sb.from("fix_card_copy_cache").upsert(
      {
        issue_type: issueType,
        copy,
        model: result.model,
        verified: false,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "issue_type" },
    );

    return copy;
  } catch (err) {
    console.error(`[fix-card-copy-cache] generation failed for "${issueType}":`, err);
    return FALLBACK_COPY;
  }
}
