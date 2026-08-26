import "server-only";

import type { NextRequest } from "next/server";
import { secretEquals } from "@/lib/brokerage/secretEquals";

/**
 * Authenticate terminal-only admin diagnostics without putting credentials in
 * the URL. URLs are retained by browser history, reverse proxies, hosting logs,
 * and observability systems, so ADMIN_DEBUG_TOKEN is accepted only as a bearer
 * token.
 */
export function hasValidAdminDebugToken(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  return secretEquals(auth.slice("Bearer ".length), process.env.ADMIN_DEBUG_TOKEN);
}
