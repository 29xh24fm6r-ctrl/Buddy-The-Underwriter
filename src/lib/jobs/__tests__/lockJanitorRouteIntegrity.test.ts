import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(
  join(process.cwd(), "src/app/api/workers/lock-janitor/route.ts"),
  "utf8",
);

test("lock janitor returns only bounded count evidence", () => {
  assert.match(route, /released: summary\.released/);
  assert.match(route, /tridentReconciled: summary\.tridentReconciled/);
  assert.doesNotMatch(route, /details:\s*released/);
  assert.doesNotMatch(route, /tridentDetails/);
});

test("lock janitor redacts provider and database failures", () => {
  assert.match(route, /error: "janitor_rpc_failed"/);
  assert.match(route, /error: "janitor_failed"/);
  assert.doesNotMatch(route, /\.error\?\.message/);
  assert.doesNotMatch(route, /String\(error\)/);
});

test("lock janitor makes incomplete recovery non-green and non-cacheable", () => {
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(route, /janitor_rpc_failed"[\s\S]*?503/);
  assert.match(route, /janitor_failed"[\s\S]*?503/);
});

test("lock janitor validates both RPC row sets before reporting success", () => {
  assert.match(route, /summarizeLockJanitorRpcResults\(/);
  assert.match(route, /lockResult\.value\.data/);
  assert.match(route, /tridentResult\.value\.data/);
});
