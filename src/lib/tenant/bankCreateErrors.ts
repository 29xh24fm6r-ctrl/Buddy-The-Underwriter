// src/lib/tenant/bankCreateErrors.ts
// Pure functions for bank creation error classification and code generation.
// Extracted for testability — no server-only / DB dependencies.

export type BankCreateError =
  | "bank_name_conflict"
  | "bank_code_conflict"
  | "bank_insert_failed"
  | "profile_setup_failed"
  | "membership_failed";

/**
 * Classify a DB error from the banks insert into a structured cause.
 * Never exposes raw DB error to the caller — logs server-side only.
 */
export function classifyBankInsertError(
  err: { code?: string; message?: string },
  _context: { name: string; code: string; websiteUrl: string | null },
): { error: BankCreateError; detail: string; status: number } {
  const msg = err.message ?? "";
  const pgCode = err.code ?? "";

  // 23505 = unique_violation
  if (pgCode === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint")) {
    if (msg.includes("banks_code_key") || msg.includes("code")) {
      return {
        error: "bank_code_conflict",
        detail: "A bank with that code already exists. Please try again.",
        status: 409,
      };
    }
    // Generic unique violation (future-proof for name unique index)
    return {
      error: "bank_name_conflict",
      detail: "A bank with that name already exists. Please choose a different name.",
      status: 409,
    };
  }

  return {
    error: "bank_insert_failed",
    detail: "Could not create bank. Please try again.",
    status: 500,
  };
}

/**
 * Generate a short unique code from the bank name.
 * Format: ABC_XXXX where ABC is first 3 alphanumeric chars, XXXX is timestamp suffix.
 */
export function generateBankCode(name: string): string {
  const baseCode =
    name
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 3)
      .toUpperCase() || "BNK";
  return `${baseCode}_${Date.now().toString(36).slice(-4).toUpperCase()}`;
}
