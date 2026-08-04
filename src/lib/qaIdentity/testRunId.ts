import crypto from "node:crypto";

/**
 * Generates a unique test run identifier.
 *
 * Format: E2E-YYYYMMDD-HHMMSS-<6 random hex chars>
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §2
 */
export function generateTestRunId(): string {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");

  const timePart = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const randomPart = crypto.randomBytes(3).toString("hex");

  return `E2E-${datePart}-${timePart}-${randomPart}`;
}
