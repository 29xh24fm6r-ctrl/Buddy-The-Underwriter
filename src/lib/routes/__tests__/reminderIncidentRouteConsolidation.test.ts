/**
 * Buddy reminder-incident route consolidation guard.
 *
 * Eight historical POST URLs remain stable while one catch-all consumes the
 * App Router entry. Handler modules are ordinary TypeScript files and do not
 * consume Vercel route slots.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");
const INCIDENT_ROOT = resolve(ROOT, "src/app/api/admin/reminders/incidents");
const DISPATCHER = resolve(INCIDENT_ROOT, "[...path]/route.ts");
const HANDLER_ROOT = resolve(INCIDENT_ROOT, "[...path]/_handlers");

const CONTRACT = [
  { route: "ack", handler: "ack" },
  { route: "action", handler: "action" },
  { route: "assign", handler: "assign" },
  { route: "escalate/tick", handler: "escalate-tick" },
  { route: "meta", handler: "meta" },
  { route: "notes", handler: "notes" },
  { route: "postmortem", handler: "postmortem" },
  { route: "sync", handler: "sync" },
] as const;

function walkRouteFiles(directory: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...walkRouteFiles(path));
    else if (entry.name === "route.ts" || entry.name === "route.tsx") {
      routes.push(relative(INCIDENT_ROOT, path));
    }
  }
  return routes.sort();
}

describe("reminder incident route consolidation", () => {
  it("uses exactly one App Router entry for the complete incident subtree", () => {
    assert.deepEqual(walkRouteFiles(INCIDENT_ROOT), ["[...path]/route.ts"]);
  });

  it("preserves every historical POST URL through the dispatcher", () => {
    const dispatcher = readFileSync(DISPATCHER, "utf-8");

    for (const contract of CONTRACT) {
      assert.ok(
        dispatcher.includes('"' + contract.route + '"'),
        "dispatcher is missing route " + contract.route,
      );
      assert.ok(
        dispatcher.includes('"./_handlers/' + contract.handler + '"'),
        "dispatcher is missing handler " + contract.handler,
      );

      const handler = readFileSync(
        resolve(HANDLER_ROOT, contract.handler + ".ts"),
        "utf-8",
      );
      assert.match(handler, /export\s+async\s+function\s+POST\b/);
    }
  });

  it("keeps all implementations outside the route manifest", () => {
    const handlers = readdirSync(HANDLER_ROOT)
      .filter((name) => name.endsWith(".ts"))
      .sort();

    assert.equal(handlers.length, CONTRACT.length);
    assert.ok(handlers.every((name) => name !== "route.ts"));
  });

  it("fails closed for unknown incident paths", () => {
    const dispatcher = readFileSync(DISPATCHER, "utf-8");
    assert.match(dispatcher, /ROUTES\.has\(route\)/);
    assert.match(dispatcher, /error:\s*"not_found"[\s\S]*status:\s*404/);
  });
});
