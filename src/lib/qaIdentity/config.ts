import "server-only";

/**
 * QA borrower identity configuration.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1
 *
 * Environment variables:
 *   BORROWER_QA_EMAIL       — the QA borrower's email address
 *   BORROWER_TEST_AUTH_ENABLED — "true" to enable deterministic OTP (staging only)
 *   BORROWER_TEST_OTP       — deterministic OTP code (staging only, never commit)
 */

/** The QA borrower email. Never hardcoded — always from env. */
export function getQABorrowerEmail(): string | null {
  const email = process.env.BORROWER_QA_EMAIL?.trim().toLowerCase();
  return email || null;
}

/** Returns true if the given email matches the configured QA borrower email. */
export function isQABorrowerEmail(email: string): boolean {
  const qaEmail = getQABorrowerEmail();
  if (!qaEmail) return false;
  return email.trim().toLowerCase() === qaEmail;
}

/** Returns true when deterministic test OTP is enabled (staging only). */
export function isTestAuthEnabled(): boolean {
  return process.env.BORROWER_TEST_AUTH_ENABLED === "true";
}

/** Returns the configured test OTP, if any. */
export function getTestOtp(): string | null {
  return process.env.BORROWER_TEST_OTP?.trim() || null;
}

/** The QA borrower display name used when creating deals. */
export const QA_BORROWER_NAME = "Buddy QA Borrower";

/**
 * Production safety check — must be called at startup.
 * Throws if test-auth bypass is enabled in production or if a test OTP is
 * configured in production.
 */
export function assertQATestAuthSafety(): void {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && isTestAuthEnabled()) {
    throw new Error(
      "SAFETY: BORROWER_TEST_AUTH_ENABLED=true in production. " +
        "Test OTP bypass must never be enabled in production. " +
        "Unset BORROWER_TEST_AUTH_ENABLED or set it to false.",
    );
  }

  if (isProduction && getTestOtp()) {
    throw new Error(
      "SAFETY: BORROWER_TEST_OTP is configured in production. " +
        "Test OTP must never be present in production environment. " +
        "Unset BORROWER_TEST_OTP.",
    );
  }
}

/**
 * Returns true when all conditions for deterministic staging OTP are met:
 *   - NODE_ENV is not production
 *   - BORROWER_TEST_AUTH_ENABLED=true
 *   - BORROWER_TEST_OTP is present
 */
export function canUseDeterministicOtp(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (!isTestAuthEnabled()) return false;
  if (!getTestOtp()) return false;
  return true;
}

/**
 * Validates a code against the deterministic test OTP.
 * Only returns true when canUseDeterministicOtp() is true AND the code matches.
 */
export function validateDeterministicOtp(code: string): boolean {
  if (!canUseDeterministicOtp()) return false;
  const testOtp = getTestOtp();
  if (!testOtp) return false;
  return code.trim() === testOtp;
}
