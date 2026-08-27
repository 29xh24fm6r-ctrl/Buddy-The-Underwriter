import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

function read(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf8");
}

function routeFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(absolute));
    if (entry.isFile() && entry.name === "route.ts") out.push(absolute);
  }
  return out;
}

test("public token routes never read borrower_portal_links directly", () => {
  const root = path.join(SRC_ROOT, "app/api/portal/[token]");
  const offenders = routeFiles(root)
    .filter((file) => read(path.relative(SRC_ROOT, file)).includes('.from("borrower_portal_links")'))
    .map((file) => path.relative(SRC_ROOT, file));

  assert.deepEqual(
    offenders,
    [],
    `portal routes must use the authoritative token resolver, found direct reads in: ${offenders.join(", ")}`,
  );
});

test("shared borrower and Trident resolvers enforce the portal-link state machine", () => {
  const context = read("lib/borrower/resolvePortalContext.ts");
  assert.ok(context.includes("resolveBorrowerToken"));
  assert.ok(!context.includes('.from("borrower_portal_links")'));

  const trident = read("lib/brokerage/trident/portalTokenAuth.ts");
  assert.ok(trident.includes("peekBorrowerPortalLink"));
  assert.ok(!trident.includes('.from("borrower_portal_links")'));
});

test("high-impact portal data and mutation routes use canonical token resolution", () => {
  const routes = [
    "app/api/portal/[token]/context/route.ts",
    "app/api/portal/[token]/docs/route.ts",
    "app/api/portal/[token]/docs/[uploadId]/fields/route.ts",
    "app/api/portal/[token]/docs/[uploadId]/field-confirm/route.ts",
    "app/api/portal/[token]/docs/[uploadId]/submit/route.ts",
    "app/api/portal/[token]/checklist/route.ts",
    "app/api/portal/[token]/conditions/route.ts",
    "app/api/portal/[token]/conditions/[conditionId]/upload/route.ts",
    "app/api/portal/[token]/guidance/route.ts",
    "app/api/portal/[token]/guided/context/route.ts",
    "app/api/portal/[token]/guided/confirm/route.ts",
    "app/api/portal/[token]/loan-requests/route.ts",
    "app/api/portal/[token]/request-status/route.ts",
  ];

  for (const route of routes) {
    assert.ok(
      read(route).includes("resolveBorrowerToken"),
      `${route} must use resolveBorrowerToken`,
    );
  }
});

test("public document metadata never exposes private storage coordinates", () => {
  const docs = read("app/api/portal/[token]/docs/route.ts");
  assert.ok(!docs.includes("storage_bucket"));
  assert.ok(!docs.includes("storage_path"));
  assert.ok(!docs.includes("storage:"));
});
