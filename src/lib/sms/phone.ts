import "server-only";

/**
 * Normalize phone number to E.164 format
 * 
 * Basic normalization:
 * - Trim whitespace
 * - Keep leading +
 * - Remove spaces, dashes, parens
 * - Does NOT validate format (Twilio does that)
 * 
 * Examples:
 * - "+1 (555) 123-4567" → "+15551234567"
 * - "555-123-4567" → "5551234567" (not E.164, but preserved)
 * - "+14703005945" → "+14703005945" (already E.164)
 */
export function normalizeE164(input: string | null | undefined): string {
  if (!input) return "";
  
  const trimmed = input.trim();
  
  // Remove common formatting characters
  const cleaned = trimmed
    .replace(/[\s\-\(\)\.]/g, ""); // Remove spaces, dashes, parens, dots
  
  return cleaned;
}

/**
 * Validate E.164 format (basic check)
 * Returns true if string looks like E.164: starts with +, 10-15 digits
 */
export function isE164(input: string): boolean {
  if (!input) return false;
  return /^\+\d{10,15}$/.test(input);
}
