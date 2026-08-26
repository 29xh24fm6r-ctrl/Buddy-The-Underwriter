// SPEC-ROUTE-CAPACITY-2: Single catch-all for Buddy brokerage CRM APIs.
// Every historical URL is preserved; only the filesystem route topology changes.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ResolvedRoute = {
  key: string;
  params: Record<string, string>;
};

const NOT_FOUND = () =>
  NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

const METHOD_NOT_ALLOWED = (allow: Method[]) =>
  NextResponse.json(
    { ok: false, error: "method_not_allowed" },
    { status: 405, headers: { Allow: allow.join(", ") } },
  );

const STATIC_ROUTES = new Set([
  "activities",
  "deals-search",
  "dedup",
  "intelligence",
  "leads",
  "organizations",
  "people",
  "relationships",
  "search",
  "sequences",
  "comms/send",
  "comms/templates",
  "intelligence/ai-assist",
  "intelligence/alerts",
]);

function resolveRoute(path: string[]): ResolvedRoute | null {
  const route = path.join("/");
  if (STATIC_ROUTES.has(route)) return { key: route, params: {} };

  if (path.length === 2 && path[0] === "leads") {
    return { key: "leads/:leadId", params: { leadId: path[1] } };
  }
  if (path.length === 2 && path[0] === "organizations") {
    return { key: "organizations/:orgId", params: { orgId: path[1] } };
  }
  if (path.length === 2 && path[0] === "people") {
    return { key: "people/:personId", params: { personId: path[1] } };
  }
  if (
    path.length === 3 &&
    path[0] === "deals" &&
    path[2] === "parties"
  ) {
    return {
      key: "deals/:dealId/parties",
      params: { dealId: path[1] },
    };
  }
  if (
    path.length === 3 &&
    path[0] === "leads" &&
    path[2] === "actions"
  ) {
    return {
      key: "leads/:leadId/actions",
      params: { leadId: path[1] },
    };
  }
  if (
    path.length === 3 &&
    path[0] === "leads" &&
    path[2] === "qualification"
  ) {
    return {
      key: "leads/:leadId/qualification",
      params: { leadId: path[1] },
    };
  }
  if (
    path.length === 3 &&
    path[0] === "organizations" &&
    path[2] === "attribute-deal"
  ) {
    return {
      key: "organizations/:orgId/attribute-deal",
      params: { orgId: path[1] },
    };
  }
  if (
    path.length === 4 &&
    path[0] === "deals" &&
    path[2] === "parties"
  ) {
    return {
      key: "deals/:dealId/parties/:partyRoleId",
      params: { dealId: path[1], partyRoleId: path[3] },
    };
  }

  return null;
}

async function dispatch(method: Method, req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = resolveRoute(path);
  if (!route) return NOT_FOUND();

  switch (route.key) {
    case "activities":
      if (method === "POST") return (await import("./_handlers/activities")).POST(req);
      return METHOD_NOT_ALLOWED(["POST"]);
    case "deals-search":
      if (method === "GET") return (await import("./_handlers/deals-search")).GET(req);
      return METHOD_NOT_ALLOWED(["GET"]);
    case "dedup":
      if (method === "GET") return (await import("./_handlers/dedup")).GET(req);
      if (method === "POST") return (await import("./_handlers/dedup")).POST(req);
      return METHOD_NOT_ALLOWED(["GET", "POST"]);
    case "intelligence":
      if (method === "GET") return (await import("./_handlers/intelligence")).GET(req);
      return METHOD_NOT_ALLOWED(["GET"]);
    case "leads":
      if (method === "GET") return (await import("./_handlers/leads")).GET(req);
      if (method === "POST") return (await import("./_handlers/leads")).POST(req);
      return METHOD_NOT_ALLOWED(["GET", "POST"]);
    case "organizations":
      if (method === "GET") return (await import("./_handlers/organizations")).GET(req);
      if (method === "POST") return (await import("./_handlers/organizations")).POST(req);
      return METHOD_NOT_ALLOWED(["GET", "POST"]);
    case "people":
      if (method === "GET") return (await import("./_handlers/people")).GET(req);
      if (method === "POST") return (await import("./_handlers/people")).POST(req);
      return METHOD_NOT_ALLOWED(["GET", "POST"]);
    case "relationships":
      if (method === "GET") return (await import("./_handlers/relationships")).GET(req);
      return METHOD_NOT_ALLOWED(["GET"]);
    case "search":
      if (method === "GET") return (await import("./_handlers/search")).GET(req);
      return METHOD_NOT_ALLOWED(["GET"]);
    case "sequences":
      if (method === "GET") return (await import("./_handlers/sequences")).GET(req);
      if (method === "POST") return (await import("./_handlers/sequences")).POST(req);
      return METHOD_NOT_ALLOWED(["GET", "POST"]);
    case "comms/send":
      if (method === "POST") return (await import("./_handlers/comms-send")).POST(req);
      return METHOD_NOT_ALLOWED(["POST"]);
    case "comms/templates":
      if (method === "GET") return (await import("./_handlers/comms-templates")).GET(req);
      if (method === "PUT") return (await import("./_handlers/comms-templates")).PUT(req);
      return METHOD_NOT_ALLOWED(["GET", "PUT"]);
    case "intelligence/ai-assist":
      if (method === "POST") return (await import("./_handlers/intelligence-ai-assist")).POST(req);
      return METHOD_NOT_ALLOWED(["POST"]);
    case "intelligence/alerts":
      if (method === "GET") return (await import("./_handlers/intelligence-alerts")).GET(req);
      if (method === "POST") return (await import("./_handlers/intelligence-alerts")).POST(req);
      return METHOD_NOT_ALLOWED(["GET", "POST"]);
    case "leads/:leadId": {
      const handlerCtx = { params: Promise.resolve({ leadId: route.params.leadId }) };
      if (method === "GET") return (await import("./_handlers/leads-leadId")).GET(req, handlerCtx);
      if (method === "PATCH") return (await import("./_handlers/leads-leadId")).PATCH(req, handlerCtx);
      return METHOD_NOT_ALLOWED(["GET", "PATCH"]);
    }
    case "organizations/:orgId": {
      const handlerCtx = { params: Promise.resolve({ orgId: route.params.orgId }) };
      if (method === "GET") return (await import("./_handlers/organizations-orgId")).GET(req, handlerCtx);
      if (method === "PATCH") return (await import("./_handlers/organizations-orgId")).PATCH(req, handlerCtx);
      if (method === "POST") return (await import("./_handlers/organizations-orgId")).POST(req, handlerCtx);
      return METHOD_NOT_ALLOWED(["GET", "PATCH", "POST"]);
    }
    case "people/:personId": {
      const handlerCtx = { params: Promise.resolve({ personId: route.params.personId }) };
      if (method === "GET") return (await import("./_handlers/people-personId")).GET(req, handlerCtx);
      if (method === "PATCH") return (await import("./_handlers/people-personId")).PATCH(req, handlerCtx);
      if (method === "POST") return (await import("./_handlers/people-personId")).POST(req, handlerCtx);
      if (method === "DELETE") return (await import("./_handlers/people-personId")).DELETE(req);
      return METHOD_NOT_ALLOWED(["GET", "PATCH", "POST", "DELETE"]);
    }
    case "deals/:dealId/parties": {
      const handlerCtx = { params: Promise.resolve({ dealId: route.params.dealId }) };
      if (method === "GET") return (await import("./_handlers/deals-dealId-parties")).GET(req, handlerCtx);
      if (method === "POST") return (await import("./_handlers/deals-dealId-parties")).POST(req, handlerCtx);
      return METHOD_NOT_ALLOWED(["GET", "POST"]);
    }
    case "leads/:leadId/actions": {
      const handlerCtx = { params: Promise.resolve({ leadId: route.params.leadId }) };
      if (method === "POST") return (await import("./_handlers/leads-leadId-actions")).POST(req, handlerCtx);
      return METHOD_NOT_ALLOWED(["POST"]);
    }
    case "leads/:leadId/qualification": {
      const handlerCtx = { params: Promise.resolve({ leadId: route.params.leadId }) };
      if (method === "GET") return (await import("./_handlers/leads-leadId-qualification")).GET(req, handlerCtx);
      if (method === "PUT") return (await import("./_handlers/leads-leadId-qualification")).PUT(req, handlerCtx);
      return METHOD_NOT_ALLOWED(["GET", "PUT"]);
    }
    case "organizations/:orgId/attribute-deal": {
      const handlerCtx = { params: Promise.resolve({ orgId: route.params.orgId }) };
      if (method === "POST") return (await import("./_handlers/organizations-orgId-attribute-deal")).POST(req, handlerCtx);
      return METHOD_NOT_ALLOWED(["POST"]);
    }
    case "deals/:dealId/parties/:partyRoleId": {
      const handlerCtx = {
        params: Promise.resolve({
          dealId: route.params.dealId,
          partyRoleId: route.params.partyRoleId,
        }),
      };
      if (method === "DELETE") return (await import("./_handlers/deals-dealId-parties-partyRoleId")).DELETE(req, handlerCtx);
      return METHOD_NOT_ALLOWED(["DELETE"]);
    }
    default:
      return NOT_FOUND();
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return dispatch("GET", req, ctx);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return dispatch("POST", req, ctx);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  return dispatch("PUT", req, ctx);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return dispatch("PATCH", req, ctx);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return dispatch("DELETE", req, ctx);
}
