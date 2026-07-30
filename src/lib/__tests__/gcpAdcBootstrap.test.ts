/**
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §1 — gcpAdcBootstrap.ts's new
 * getVertexAccessToken(). Covers the WIF-authClient branch via the
 * __setVertexAuthOptionsForTests seam; the no-authClient fallback branch
 * delegates to google-auth-library's own ADC resolution and is
 * intentionally not exercised here (network/environment-dependent, same
 * as this repo's general stance on not unit-testing third-party SDK
 * internals).
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const {
  getVertexAccessToken,
  __setVertexAuthOptionsForTests,
  __resetVertexAuthOptionsForTests,
} = require("../gcpAdcBootstrap") as typeof import("../gcpAdcBootstrap");

afterEach(() => {
  __resetVertexAuthOptionsForTests();
});

describe("getVertexAccessToken: WIF authClient branch", () => {
  it("returns the token when authClient.getAccessToken() resolves a string", async () => {
    __setVertexAuthOptionsForTests(async () => ({
      authClient: { getAccessToken: async () => "raw-string-token" } as any,
    }));
    const token = await getVertexAccessToken();
    assert.equal(token, "raw-string-token");
  });

  it("returns the token when authClient.getAccessToken() resolves { token }", async () => {
    __setVertexAuthOptionsForTests(async () => ({
      authClient: { getAccessToken: async () => ({ token: "object-shaped-token" }) } as any,
    }));
    const token = await getVertexAccessToken();
    assert.equal(token, "object-shaped-token");
  });

  it("throws a clear error when the authClient returns no token", async () => {
    __setVertexAuthOptionsForTests(async () => ({
      authClient: { getAccessToken: async () => ({ token: undefined }) } as any,
    }));
    await assert.rejects(() => getVertexAccessToken(), /WIF authClient returned no token/);
  });
});
