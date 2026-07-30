import "server-only";

/**
 * SPEC-M7 ZERO-REPEAT-PREFILL-1 — the gateway's `structurer` role's first
 * real caller (configured OpenAI/JSON-schema since SPEC-M1; zero call sites
 * existed before this).
 *
 * Resolves the one genuine residue case flagged in
 * form1919/inputBuilder.ts's own doc comment: a loan's use-of-proceeds is
 * either a single free-text description or a jsonb array of itemized
 * purposes (deal_loan_requests.use_of_proceeds: `[{category, amount, notes}]`
 * per its migration comment), but Form 1919 has 7 fixed, mutually-exclusive
 * purpose-amount fields (debt refinance / purchase-construction / equipment
 * / working capital / business acquisition / inventory / other) that
 * inputBuilder.ts currently never populates — everything routes to the
 * generic "Other" bucket instead.
 *
 * Invariant #1 (LLMs never compute a canonical financial value): this
 * function NEVER invents or estimates a dollar amount. It only ever does
 * one of two things with an amount that's already given to it —
 *   (a) an item that already has its own amount gets re-labeled into the
 *       correct category, or
 *   (b) when there is exactly ONE identifiable overall purpose and no
 *       per-item breakdown, the single known total may be assigned whole
 *       to that one category.
 * Anything else (multiple purposes mentioned with no way to know the real
 * split) is left uncategorized — same "Other" bucket as today, never a
 * fabricated split. The system instruction states this explicitly.
 */

import { runRole } from "./gateway";

export type UseOfProceedsCategory =
  | "debt_refinance"
  | "purchase_or_construction"
  | "equipment"
  | "working_capital"
  | "business_acquisition"
  | "inventory"
  | "other";

export type UseOfProceedsLineItem = {
  description: string | null;
  category: string | null;
  amount: number | null;
};

export type CategorizedUseOfProceeds = {
  category: UseOfProceedsCategory;
  amount: number;
  description: string | null;
};

export type UseOfProceedsClassification = {
  categorized: CategorizedUseOfProceeds[];
  /** True when some or all of the total couldn't be confidently categorized (left in "other" rather than a guessed split). */
  hasUncategorizedResidue: boolean;
  rationale: string;
};

const CATEGORIES: UseOfProceedsCategory[] = [
  "debt_refinance",
  "purchase_or_construction",
  "equipment",
  "working_capital",
  "business_acquisition",
  "inventory",
  "other",
];

const STRUCTURER_SYSTEM_INSTRUCTION =
  "You are a data-classification assistant for SBA Form 1919. You are given a loan's " +
  "total requested amount and a description of what it's for — either a single " +
  "free-text description or a list of itemized purposes, each possibly with its own " +
  "dollar amount already stated. Classify the spending into these exact categories: " +
  `${CATEGORIES.join(", ")}. ` +
  "You must NEVER invent, estimate, or guess a dollar amount that isn't already given " +
  "to you. If an item already states its own amount, keep that exact amount and only " +
  "choose which category it belongs to. If there is exactly one overall purpose and no " +
  "per-item amounts, you may assign the single known total amount, unchanged, to that " +
  "one best-matching category. If multiple purposes are mentioned with no way to know " +
  "how the total splits between them, do not guess a split — return the full amount, " +
  "unchanged, under category \"other\" instead, and set hasUncategorizedResidue to true.";

const USE_OF_PROCEEDS_SCHEMA = {
  type: "object",
  properties: {
    categorized: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: CATEGORIES },
          amount: { type: "number" },
          description: { type: "string" },
        },
        required: ["category", "amount"],
        additionalProperties: false,
      },
    },
    hasUncategorizedResidue: { type: "boolean" },
    rationale: { type: "string" },
  },
  required: ["categorized", "hasUncategorizedResidue", "rationale"],
  additionalProperties: false,
} as const;

function buildPrompt(totalLoanAmount: number | null, lineItems: UseOfProceedsLineItem[]): string {
  return [
    `TOTAL LOAN AMOUNT: ${totalLoanAmount ?? "unknown"}`,
    "",
    "USE-OF-PROCEEDS ITEMS (amount is null when no per-item amount is known — do not invent one):",
    JSON.stringify(lineItems, null, 2),
    "",
    "Classify this spending per the categories and rules above. The sum of every " +
      "categorized[].amount must equal the total loan amount if a total was given — " +
      "never more, never less, never invented.",
  ].join("\n");
}

function isCategorized(x: unknown): x is CategorizedUseOfProceeds {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  return (
    typeof c.category === "string" &&
    (CATEGORIES as string[]).includes(c.category) &&
    typeof c.amount === "number"
  );
}

/**
 * Pure w.r.t. persistence — takes line items and a total, returns a
 * classification. Never throws for a malformed/unparseable structurer
 * response — falls back to the same "everything in Other, nothing
 * invented" behavior the codebase already has today, so a structurer
 * failure degrades to the pre-M7 status quo rather than blocking anything.
 */
export async function classifyUseOfProceeds(input: {
  dealId: string;
  totalLoanAmount: number | null;
  lineItems: UseOfProceedsLineItem[];
  npiTagged?: boolean;
}): Promise<UseOfProceedsClassification> {
  const fallback: UseOfProceedsClassification = {
    categorized:
      input.totalLoanAmount != null
        ? [
            {
              category: "other",
              amount: input.totalLoanAmount,
              description: input.lineItems.map((l) => l.description ?? l.category).filter(Boolean).join("; ") || null,
            },
          ]
        : [],
    hasUncategorizedResidue: true,
    rationale: "Structurer call failed or returned unparseable output; kept the existing Other-bucket behavior.",
  };

  if (input.lineItems.length === 0) return fallback;

  try {
    const result = await runRole("structurer", {
      prompt: buildPrompt(input.totalLoanAmount, input.lineItems),
      systemInstruction: STRUCTURER_SYSTEM_INSTRUCTION,
      responseSchema: USE_OF_PROCEEDS_SCHEMA,
      purpose: "use_of_proceeds_classification",
      dealId: input.dealId,
      npiTagged: input.npiTagged,
    });

    const parsed = JSON.parse(result.text);
    const categorized = Array.isArray(parsed?.categorized) ? parsed.categorized.filter(isCategorized) : [];
    if (categorized.length === 0) return fallback;

    return {
      categorized,
      hasUncategorizedResidue: Boolean(parsed?.hasUncategorizedResidue),
      rationale: typeof parsed?.rationale === "string" ? parsed.rationale : "",
    };
  } catch {
    return fallback;
  }
}
