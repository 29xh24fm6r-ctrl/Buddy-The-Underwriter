import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routePath = (relativePath: string) =>
  path.resolve(process.cwd(), relativePath);

test("builder verify and meta routes are registered", () => {
  const buildRoute = routePath("src/app/api/_meta/build/route.ts");
  const verifyRoute = routePath("src/app/api/_builder/verify/underwrite/route.ts");

  assert.ok(fs.existsSync(buildRoute));
  assert.ok(fs.existsSync(verifyRoute));
});
