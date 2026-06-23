/**
 * Decision route family — catch-all dispatcher.
 *
 * Consolidates the /api/deals/[dealId]/decision/** child routes into one route file for Vercel
 * route-cap headroom. Public URLs, HTTP methods, params, auth, status codes and response bodies
 * (incl. PDF/ZIP binary responses) are preserved exactly — each former route's logic lives
 * verbatim in ../_handlers/*, and this dispatcher maps path segments to them via the pure
 * matchDecisionPath table. The base /decision endpoint keeps its own route.ts (a catch-all does
 * not match the empty segment).
 *
 * Route-segment config is the superset of the former routes (nodejs, force-dynamic, Spec D5
 * maxDuration 60) so no consolidated endpoint loses its previous headroom.
 */

import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { matchDecisionPath, type DecisionMethod } from "../_handlers/dispatchTable";

import * as generate from "../_handlers/generate";
import * as latest from "../_handlers/latest";
import * as auditExport from "../_handlers/audit-export";
import * as snapshot from "../_handlers/snapshot";
import * as attest from "../_handlers/attest";
import * as committeeStatus from "../_handlers/committee-status";
import * as counterfactual from "../_handlers/counterfactual";
import * as diff from "../_handlers/diff";
import * as finalize from "../_handlers/finalize";
import * as pdf from "../_handlers/pdf";
import * as regulatorZip from "../_handlers/regulator-zip";
import * as committeeDissent from "../_handlers/committee/dissent";
import * as committeeMinutes from "../_handlers/committee/minutes";
import * as committeeStatusInner from "../_handlers/committee/status";
import * as committeeVote from "../_handlers/committee/vote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteHandler = (req: NextRequest, ctx: { params: Promise<{ dealId: string; snapshotId: string }> }) => Promise<Response> | Response;
type HandlerModule = Partial<Record<DecisionMethod, RouteHandler>>;

// handler key (from dispatchTable) → the actual server-only module.
const MODULES: Record<string, HandlerModule> = {
  "generate": generate as HandlerModule,
  "latest": latest as HandlerModule,
  "audit-export": auditExport as HandlerModule,
  "snapshot": snapshot as HandlerModule,
  "attest": attest as HandlerModule,
  "committee-status": committeeStatus as HandlerModule,
  "counterfactual": counterfactual as HandlerModule,
  "diff": diff as HandlerModule,
  "finalize": finalize as HandlerModule,
  "pdf": pdf as HandlerModule,
  "regulator-zip": regulatorZip as HandlerModule,
  "committee/dissent": committeeDissent as HandlerModule,
  "committee/minutes": committeeMinutes as HandlerModule,
  "committee/status": committeeStatusInner as HandlerModule,
  "committee/vote": committeeVote as HandlerModule,
};

type Ctx = { params: Promise<{ dealId: string; path?: string[] }> };

async function dispatch(method: DecisionMethod, req: NextRequest, ctx: Ctx): Promise<Response> {
  const { dealId, path = [] } = await ctx.params;

  const match = matchDecisionPath(path);
  if (!match) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!match.route.methods.includes(method)) {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const fn = MODULES[match.route.handler]?.[method];
  if (!fn) {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  // Reconstruct the exact params shape the original route handler expects.
  const params = Promise.resolve({ dealId, snapshotId: match.params.snapshotId as string });
  // The handler's own Response (JSON, PDF, ZIP, …) is returned untouched.
  return fn(req, { params });
}

export const GET = (req: NextRequest, ctx: Ctx) => dispatch("GET", req, ctx);
export const POST = (req: NextRequest, ctx: Ctx) => dispatch("POST", req, ctx);
