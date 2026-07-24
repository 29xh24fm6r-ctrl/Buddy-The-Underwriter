/**
 * Gate for the entire mock-vendor test harness (mock Persona identity
 * verification, mock DocuSeal e-signature) — built to unblock a full
 * end-to-end walkthrough of the Brokerage borrower flow in environments
 * with no real Persona/DocuSeal credentials, real vendor deployment, or
 * network access to sba.gov/irs.gov for template ingestion.
 *
 * Deliberately double-gated: BUDDY_MOCK_VENDORS must be explicitly set to
 * "true" AND NODE_ENV must not be "production". Either check alone is a
 * single point of failure — a stray env var in prod, or a misconfigured
 * NODE_ENV in a staging environment that still handles real money. Both
 * must hold for a fake identity verification or a fake signed document to
 * ever be creatable. Real vendor DB rows are tagged distinctly (e.g.
 * vendor="mock_persona" vs "persona") specifically so a fake record can
 * never be mistaken for a real one even if this gate were ever bypassed.
 */
export function isMockVendorsEnabled(): boolean {
  return process.env.BUDDY_MOCK_VENDORS === "true" && process.env.NODE_ENV !== "production";
}
