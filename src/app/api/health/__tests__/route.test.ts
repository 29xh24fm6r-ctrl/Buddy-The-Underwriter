import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

// The route now carries `import "server-only"`, whose runtime guard throws
// outside the react-server condition. Redirect it to the repo stub before the
// route module loads — a static import of ../route would be hoisted above this
// call, so the route is required lazily, matching the other route tests.
mockServerOnly();
const require = createRequire(import.meta.url);
const { GET } = require("../route") as typeof import("../route");

test("public liveness exposes only bounded service state", async () => {
  const response = await GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "ok",
    service: "buddy-the-underwriter",
  });
});

test("public liveness has no deployment or provider diagnostics", async () => {
  const serialized = JSON.stringify(await (await GET()).json());

  assert.doesNotMatch(
    serialized,
    /deployment|commit|branch|ref|vercel|pulse|provider|connected|urlSet|detail/i,
  );
});
