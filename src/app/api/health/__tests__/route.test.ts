import test from "node:test";
import assert from "node:assert/strict";

import { GET } from "../route";

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
