/**
 * Real-router scan for the brokerage security gate.
 *
 * Audit C3: runSecurityGate previously fed runSecurityAudit hand-written
 * RouteContract[] with resolvesIdentityServerSide:true for every route (and named
 * routes that don't exist) — so the gate graded fabricated inputs and always
 * passed. This derives the contracts from the actual route files on disk: a
 * brokerage/lender route "resolves identity server-side" only if it references a
 * real auth primitive, and "has a rate limit" only if it references a limiter.
 */
import fs from "node:fs";
import path from "node:path";
import type { RouteContract, RateLimitSpec } from "./securityAudit";

// A route resolves identity server-side if it references one of these.
const AUTH_PRIMITIVES = [
  "getBorrowerSession",
  "getOrCreateBorrowerSession",
  "resolveLenderIdentity",
  "requireBrokerageCommsAdmin",
  "verifyCronSecret",
  "requireSuperAdmin",
  "requireRoleApi",
  "assertDealAccess",
  "clerkAuth",
  "bank_user_memberships",
  "GATEWAY_SECRET",
];
const RATE_LIMIT_MARKERS = ["checkConciergeRateLimit", "incrementAndCheck", "rateLimit("];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function walkRouteFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkRouteFiles(full, out);
    else if (entry.isFile() && entry.name === "route.ts") out.push(full);
  }
  return out;
}

function fileToUrl(file: string, apiRoot: string): string {
  const rel = file.slice(apiRoot.length).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
  return "/api" + rel;
}

export function scanBrokerageRoutes(
  apiRoot = path.join(process.cwd(), "src/app/api"),
): { routes: RouteContract[]; rateLimits: RateLimitSpec[] } {
  const files = [
    ...walkRouteFiles(path.join(apiRoot, "brokerage")),
    ...walkRouteFiles(path.join(apiRoot, "lender")),
  ];
  const routes: RouteContract[] = [];
  const rateLimits: RateLimitSpec[] = [];

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const url = fileToUrl(file, apiRoot);
    const methods = HTTP_METHODS.filter((m) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src),
    );
    routes.push({
      path: url,
      methods,
      resolvesIdentityServerSide: AUTH_PRIMITIVES.some((a) => src.includes(a)),
      // Client-supplied tenant ids read from the request body are the leak vector.
      acceptsClientBankId: /body[?.\s]*\.?\s*(bankId|bank_id)/.test(src),
      acceptsClientDealId: /body[?.\s]*\.?\s*(dealId|deal_id)/.test(src),
    });
    rateLimits.push({
      route: url,
      hasRateLimit: RATE_LIMIT_MARKERS.some((m) => src.includes(m)),
      limitType: "detected",
    });
  }

  return { routes, rateLimits };
}
