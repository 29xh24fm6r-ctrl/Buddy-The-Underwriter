import type { NextRequest } from "next/server";

/**
 * Test mode is ONLY enabled when:
 * - query param ?__mode=test
 * - AND request has header x-buddy-internal: true
 *
 * This prevents accidental exposure in production.
 */
export function getTestMode(req: NextRequest | Request): boolean {
  const url = new URL(req.url);
  const isTest = url.searchParams.get("__mode") === "test";

  const h = "headers" in req ? req.headers : undefined;
  const isInternal = h?.get("x-buddy-internal") === "true";

  return Boolean(isTest && isInternal);
}
