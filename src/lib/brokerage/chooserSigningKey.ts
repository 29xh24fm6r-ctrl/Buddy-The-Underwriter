import "server-only";

/**
 * Resolve the key used for short-lived post-OTP chooser cookies.
 *
 * A dedicated secret permits independent rotation. The Supabase service-role
 * key remains a backwards-compatible server-secret fallback so deployment
 * does not require an atomic environment change. Public/publishable keys are
 * never accepted: they are intentionally visible to every browser.
 */
export function getChooserSigningKey(): string {
  const dedicated = process.env.BORROWER_CHOOSER_SIGNING_SECRET?.trim();
  if (dedicated) return dedicated;

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRole) return serviceRole;

  if (process.env.NODE_ENV !== "production") {
    return "buddy-chooser-development-only-signing-key";
  }

  throw new Error(
    "Missing BORROWER_CHOOSER_SIGNING_SECRET (or SUPABASE_SERVICE_ROLE_KEY fallback) for chooser cookie signing.",
  );
}
