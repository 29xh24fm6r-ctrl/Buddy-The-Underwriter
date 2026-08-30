import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("production auth debug routes are not shipped", () => {
  const debugRouteDirectory = resolve(process.cwd(), "src/app/api/auth/debug");
  assert.equal(
    existsSync(debugRouteDirectory),
    false,
    "src/app/api/auth/debug must not exist in a production build",
  );
});
