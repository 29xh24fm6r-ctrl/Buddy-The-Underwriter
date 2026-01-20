import test from "node:test";
import assert from "node:assert/strict";

import { buildBuilderTokenStatus, mustBuilderToken } from "@/lib/builder/mustBuilderTokenCore";

const ORIGINAL_ENV = process.env.BUDDY_BUILDER_VERIFY_TOKEN;

function withEnv(token: string | undefined, fn: () => void) {
  process.env.BUDDY_BUILDER_VERIFY_TOKEN = token;
  try {
    fn();
  } finally {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.BUDDY_BUILDER_VERIFY_TOKEN;
    } else {
      process.env.BUDDY_BUILDER_VERIFY_TOKEN = ORIGINAL_ENV;
    }
  }
}

test("buildBuilderTokenStatus reports env/header presence without leaking token", () => {
  withEnv("super-secret", () => {
    const req = new Request("http://localhost", {
      headers: { "x-buddy-builder-token": "super-secret" },
    });
    const status = buildBuilderTokenStatus(req);
    assert.equal(status.envPresent, true);
    assert.equal(status.headerPresent, true);
    assert.equal(status.auth, true);
    assert.ok(status.tokenHash?.startsWith("sha256:"));
    assert.ok(!status.tokenHash?.includes("super-secret"));
  });
});

test("buildBuilderTokenStatus marks auth false when header missing", () => {
  withEnv("token", () => {
    const req = new Request("http://localhost");
    const status = buildBuilderTokenStatus(req);
    assert.equal(status.envPresent, true);
    assert.equal(status.headerPresent, false);
    assert.equal(status.auth, false);
  });
});

test("mustBuilderToken throws on missing token", () => {
  withEnv("token", () => {
    const req = new Request("http://localhost");
    let threw = false;
    try {
      mustBuilderToken(req);
    } catch (err: any) {
      threw = true;
      assert.equal(err?.status, 401);
    }
    assert.equal(threw, true);
  });
});
