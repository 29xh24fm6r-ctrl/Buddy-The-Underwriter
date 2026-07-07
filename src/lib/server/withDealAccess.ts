import "server-only";

/**
 * SPEC-SEC-1 — Deal Route Tenant Isolation
 *
 * Route-level glue around assertDealAccess:
 *
 *  - accessErrorToResponse(err): converts a typed AccessError into a JSON
 *    NextResponse (401/403/404). Returns null for any other error so the
 *    caller's own catch can handle it (usually a 500). Use inside an existing
 *    route try/catch.
 *
 *  - withDealAccess(handler): wraps a CLERK deal route handler so access is
 *    asserted before the handler runs. This is the canonical pattern for new
 *    routes (SPEC-SEC-2). The resolved { dealId, bankId, userId } is passed to
 *    the handler as its third argument.
 *
 * Middleware (src/proxy.ts) deliberately does NOT gate /api/**, so every deal
 * route must enforce access itself. See docs / SPEC-SEC-1.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertDealAccess } from "./deal-access";
import { isAccessError } from "./access-errors";

export type DealAccessContext = {
  dealId: string;
  bankId: string;
  userId: string;
};

/**
 * Convert a typed AccessError into a controlled JSON response.
 * Returns null when `err` is not an AccessError (caller handles it).
 */
export function accessErrorToResponse(err: unknown): NextResponse | null {
  if (isAccessError(err)) {
    return NextResponse.json(
      { ok: false, error: err.code },
      { status: err.status },
    );
  }
  return null;
}

type DealRouteCtx = { params: Promise<{ dealId: string }> };

type DealRouteHandler = (
  req: NextRequest,
  ctx: DealRouteCtx,
  access: DealAccessContext,
) => Promise<Response> | Response;

/**
 * Wrap a CLERK deal route handler with an up-front access assertion.
 * Access failures short-circuit to 401/403/404 before the handler runs.
 */
export function withDealAccess(handler: DealRouteHandler) {
  return async (req: NextRequest, ctx: DealRouteCtx): Promise<Response> => {
    let access: DealAccessContext;
    try {
      const { dealId } = await ctx.params;
      access = await assertDealAccess(dealId);
    } catch (err) {
      const res = accessErrorToResponse(err);
      if (res) return res;
      throw err;
    }
    return handler(req, ctx, access);
  };
}
