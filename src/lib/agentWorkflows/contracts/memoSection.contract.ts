/**
 * Credit Memo Narrative Section Contract
 *
 * Validates financial narrative sections in credit memos.
 * Shape mirrors FinancialNarrative from creditMemo/narrative/buildNarrative.ts.
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 */

import { z } from "zod";

// ── Schema ──────────────────────────────────────────────────────────

export const MemoNarrativeContract = z.object({
  executiveSummary: z
    .string()
    .min(20, "Executive summary must be at least 20 characters"),
  cashFlowAnalysis: z
    .string()
    .min(20, "Cash flow analysis must be at least 20 characters"),
  risks: z
    .array(z.string().min(1))
    .min(1, "At least one risk factor is required"),
  mitigants: z
    .array(z.string().min(1))
    .min(1, "At least one mitigant is required"),
  recommendation: z
    .string()
    .min(10, "Recommendation must be at least 10 characters"),
});

// ── Types ───────────────────────────────────────────────────────────

export type MemoNarrativeOutput = z.infer<typeof MemoNarrativeContract>;

// ── Validator ───────────────────────────────────────────────────────

export type ValidationResult = {
  ok: boolean;
  data?: MemoNarrativeOutput;
  errors?: z.ZodError;
  severity: "block" | "warn";
};

export function validateMemoNarrative(data: unknown): ValidationResult {
  const result = MemoNarrativeContract.safeParse(data);

  if (result.success) {
    return { ok: true, data: result.data, severity: "warn" };
  }

  // Missing required narrative fields = block
  const hasMissingRequired = result.error.issues.some(
    (i) => i.code === "invalid_type" && i.message.includes("received undefined"),
  );

  return {
    ok: false,
    errors: result.error,
    severity: hasMissingRequired ? "block" : "warn",
  };
}
