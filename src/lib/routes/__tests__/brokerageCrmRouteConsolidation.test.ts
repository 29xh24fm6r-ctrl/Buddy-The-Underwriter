/**
 * SPEC-ROUTE-CAPACITY-2 — Buddy brokerage CRM route consolidation guard.
 *
 * The public URL and HTTP-method contract stays unchanged while 22 App Router
 * entries become one catch-all. Handler modules remain ordinary TypeScript
 * files, so they do not consume Vercel route slots.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");
const CRM_ROOT = resolve(ROOT, "src/app/api/admin/brokerage/crm");
const DISPATCHER = resolve(CRM_ROOT, "[...path]/route.ts");
const HANDLER_ROOT = resolve(CRM_ROOT, "[...path]/_handlers");

const CONTRACT = [
  { route: "activities", handler: "activities", methods: ["POST"] },
  { route: "deals-search", handler: "deals-search", methods: ["GET"] },
  { route: "dedup", handler: "dedup", methods: ["GET", "POST"] },
  { route: "intelligence", handler: "intelligence", methods: ["GET"] },
  { route: "leads", handler: "leads", methods: ["GET", "POST"] },
  { route: "organizations", handler: "organizations", methods: ["GET", "POST"] },
  { route: "people", handler: "people", methods: ["GET", "POST"] },
  { route: "relationships", handler: "relationships", methods: ["GET"] },
  { route: "search", handler: "search", methods: ["GET"] },
  { route: "sequences", handler: "sequences", methods: ["GET", "POST"] },
  { route: "comms/send", handler: "comms-send", methods: ["POST"] },
  { route: "comms/templates", handler: "comms-templates", methods: ["GET", "PUT"] },
  { route: "intelligence/ai-assist", handler: "intelligence-ai-assist", methods: ["POST"] },
  { route: "intelligence/alerts", handler: "intelligence-alerts", methods: ["GET", "POST"] },
  { route: "leads/:leadId", handler: "leads-leadId", methods: ["GET", "PATCH"] },
  { route: "organizations/:orgId", handler: "organizations-orgId", methods: ["GET", "PATCH", "POST"] },
  { route: "people/:personId", handler: "people-personId", methods: ["GET", "PATCH", "POST", "DELETE"] },
  { route: "deals/:dealId/parties", handler: "deals-dealId-parties", methods: ["GET", "POST"] },
  { route: "leads/:leadId/actions", handler: "leads-leadId-actions", methods: ["POST"] },
  { route: "leads/:leadId/qualification", handler: "leads-leadId-qualification", methods: ["GET", "PUT"] },
  { route: "organizations/:orgId/attribute-deal", handler: "organizations-orgId-attribute-deal", methods: ["POST"] },
  { route: "deals/:dealId/parties/:partyRoleId", handler: "deals-dealId-parties-partyRoleId", methods: ["DELETE"] },
] as const;

function walkRouteFiles(directory: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...walkRouteFiles(path));
    else if (entry.name === "route.ts" || entry.name === "route.tsx") {
      routes.push(relative(CRM_ROOT, path));
    }
  }
  return routes.sort();
}

describe("brokerage CRM route consolidation", () => {
  it("uses exactly one App Router entry for the complete CRM subtree", () => {
    assert.deepEqual(walkRouteFiles(CRM_ROOT), ["[...path]/route.ts"]);
  });

  it("preserves every historical URL and method through the dispatcher", () => {
    const dispatcher = readFileSync(DISPATCHER, "utf-8");

    for (const contract of CONTRACT) {
      assert.ok(
        dispatcher.includes(`"${contract.route}"`),
        `dispatcher is missing route ${contract.route}`,
      );
      assert.ok(
        dispatcher.includes(`"./_handlers/${contract.handler}"`),
        `dispatcher is missing handler ${contract.handler}`,
      );

      const handler = readFileSync(
        resolve(HANDLER_ROOT, `${contract.handler}.ts`),
        "utf-8",
      );
      for (const method of contract.methods) {
        assert.match(
          handler,
          new RegExp(`export\\s+async\\s+function\\s+${method}\\b|export\\s+const\\s+${method}\\b`),
          `${contract.handler} must still export ${method}`,
        );
      }
    }
  });

  it("keeps the preserved implementations outside the route manifest", () => {
    const handlerFiles = readdirSync(HANDLER_ROOT)
      .filter((name) => name.endsWith(".ts"))
      .sort();

    assert.equal(handlerFiles.length, CONTRACT.length);
    assert.ok(handlerFiles.every((name) => name !== "route.ts"));
  });
});
