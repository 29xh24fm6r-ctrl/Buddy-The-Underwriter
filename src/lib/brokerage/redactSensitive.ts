import "server-only";

const SSN_PATTERN = /\b(\d{3})[-\s]?(\d{2})[-\s]?(\d{4})\b/g;

/**
 * Masks any full-SSN-shaped digit sequence in free text to ***-**-####
 * (last 4 preserved). Every SBA form this product fills only ever needs
 * SSN last-4 — a borrower accidentally speaking or typing a full SSN
 * should never persist in plaintext, whether in a transcript, an audit
 * log, or a round trip through an LLM extraction call.
 */
export function redactSsnPatterns(text: string): string {
  return text.replace(SSN_PATTERN, (_match, _area: string, _group: string, last4: string) => `***-**-${last4}`);
}
