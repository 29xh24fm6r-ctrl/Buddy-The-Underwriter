// src/lib/tenant/bankSelectErrors.ts
// Pure functions for bank selection error classification.
// No server-only / DB dependencies — safe for CI tests.

export type BankSelectError =
  | "bank_not_found"
  | "bank_is_sandbox"
  | "profile_setup_failed"
  | "membership_create_failed"
  | "activation_failed";

/**
 * Classify a DB error from the bank selection flow into a structured cause.
 * Never exposes raw DB error to the caller — logs server-side only.
 */
export function classifyBankSelectError(
  err: { code?: string; message?: string },
  _context: { bankId: string },
): { error: BankSelectError; detail: string; status: number } {
  const msg = err.message ?? "";
  const pgCode = err.code ?? "";

  // 23503 = foreign_key_violation (bank doesn't exist)
  if (pgCode === "23503" || msg.includes("foreign key") || msg.includes("violates foreign key")) {
    return {
      error: "bank_not_found",
      detail: "The selected bank no longer exists.",
      status: 404,
    };
  }

  // 23505 = unique_violation on membership (duplicate — benign)
  if (pgCode === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint")) {
    return {
      error: "membership_create_failed",
      detail: "Membership already exists.",
      status: 409,
    };
  }

  // Trigger failure from trg_bank_memberships_fill_user_id
  if (msg.includes("user_id required") || msg.includes("bank_memberships.user_id")) {
    return {
      error: "profile_setup_failed",
      detail: "Your profile must be set up before joining a bank. Please try again.",
      status: 500,
    };
  }

  return {
    error: "activation_failed",
    detail: "Could not select bank. Please try again.",
    status: 500,
  };
}
