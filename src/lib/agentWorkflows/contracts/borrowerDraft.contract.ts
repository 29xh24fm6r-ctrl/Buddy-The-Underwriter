/**
 * Borrower Draft Request Output Contract
 *
 * Validates auto-generated draft requests for missing documents.
 * Shape mirrors draft_borrower_requests table columns.
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 */

import { z } from "zod";

// ── Schema ──────────────────────────────────────────────────────────

export const BorrowerDraftContract = z.object({
  draft_subject: z.string().min(1, "Subject is required"),
  draft_message: z
    .string()
    .min(20, "Message must be at least 20 characters"),
  missing_document_type: z.string().min(1, "Document type is required"),
  evidence: z.array(z.record(z.string(), z.unknown())).default([]),
});

// ── Types ───────────────────────────────────────────────────────────

export type BorrowerDraftOutput = z.infer<typeof BorrowerDraftContract>;

// ── Validator ───────────────────────────────────────────────────────

export type ValidationResult = {
  ok: boolean;
  data?: BorrowerDraftOutput;
  errors?: z.ZodError;
  severity: "block" | "warn";
};

export function validateBorrowerDraft(data: unknown): ValidationResult {
  const result = BorrowerDraftContract.safeParse(data);

  if (result.success) {
    return { ok: true, data: result.data, severity: "warn" };
  }

  const hasMissingRequired = result.error.issues.some(
    (i) => i.code === "invalid_type" && i.message.includes("received undefined"),
  );

  return {
    ok: false,
    errors: result.error,
    severity: hasMissingRequired ? "block" : "warn",
  };
}
