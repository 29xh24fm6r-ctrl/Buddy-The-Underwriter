import "server-only";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Real Plaid SDK client — replaces the old 3-line stub
 * (src/lib/integrations/plaid.ts, deleted) that returned hardcoded fake
 * account/balance data.
 *
 * PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV must be set (sandbox in dev,
 * production gated behind separate credentials — see .env.example).
 * Multi-tenant Plaid (per-bank credentials) is deferred to v2 per spec.
 */

let cachedClient: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (cachedClient) return cachedClient;

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = (process.env.PLAID_ENV ?? "sandbox") as keyof typeof PlaidEnvironments;

  if (!clientId || !secret) {
    throw new Error(
      "Plaid not configured — missing PLAID_CLIENT_ID / PLAID_SECRET. " +
        "See .env.example. No fallback/mock client is provided; callers must handle this error explicitly.",
    );
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env] ?? PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  cachedClient = new PlaidApi(configuration);
  return cachedClient;
}

/** Test-only — clears the cached client so tests can re-resolve after mutating env. */
export function __test_resetPlaidClientCache(): void {
  cachedClient = null;
}
