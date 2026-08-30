import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

let actorResult: any;
let createResult: any;
let createError: Error | null;
let createCalls: any[];

class StripeStub {
  checkout = {
    sessions: {
      create: async (params: any) => {
        createCalls.push(params);
        if (createError) throw createError;
        return createResult;
      },
    },
  };

  constructor(_secret: string, _options: unknown) {}
}

require.cache[require.resolve("stripe")] = {
  id: "stripe-stub",
  filename: "stripe-stub",
  loaded: true,
  exports: { __esModule: true, default: StripeStub },
} as any;

require.cache[require.resolve("@/lib/server/userApiContext")] = {
  id: "actor-stub",
  filename: "actor-stub",
  loaded: true,
  exports: { resolveUserApiContext: async () => actorResult },
} as any;

const originalEnv = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID,
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
};

const { POST } = require("../route") as typeof import("../route");

beforeEach(() => {
  actorResult = {
    ok: true,
    actorProfileId: "b296dec2-66c6-4946-8ddc-850daa7f968f",
    clerkUserId: "user_123",
    sb: {},
  };
  createResult = { url: "https://checkout.stripe.com/c/pay/session_123" };
  createError = null;
  createCalls = [];
  process.env.STRIPE_SECRET_KEY = "sk_test_configured";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro_configured";
  process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID = "price_public_fallback";
  process.env.PUBLIC_BASE_URL = "https://www.buddysba.com";
});

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://www.buddysba.com/api/stripe/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

test("requires a canonical authenticated actor before provider submission", async () => {
  actorResult = { ok: false, status: 401, error: "not_authenticated" };

  const response = await POST(request("{}"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "not_authenticated",
  });
  assert.equal(createCalls.length, 0);
});

test("uses only the server-configured Pro price and binds actor metadata", async () => {
  const response = await POST(request("{}"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0].line_items, [
    { price: "price_pro_configured", quantity: 1 },
  ]);
  assert.equal(
    createCalls[0].client_reference_id,
    "b296dec2-66c6-4946-8ddc-850daa7f968f",
  );
  assert.equal(
    createCalls[0].subscription_data.metadata.actor_profile_id,
    "b296dec2-66c6-4946-8ddc-850daa7f968f",
  );
});

test("rejects a caller-supplied price that differs from configuration", async () => {
  const response = await POST(
    request(JSON.stringify({ priceId: "price_attacker_selected" })),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_price");
  assert.equal(createCalls.length, 0);
});

test("ignores the request Origin and uses the trusted public base URL", async () => {
  const response = await POST(
    request("{}", { origin: "https://attacker.example" }),
  );

  assert.equal(response.status, 200);
  assert.equal(
    createCalls[0].success_url,
    "https://www.buddysba.com/pricing?checkout=success",
  );
  assert.equal(
    createCalls[0].cancel_url,
    "https://www.buddysba.com/pricing?checkout=cancel",
  );
});

test("rejects oversized input before creating a checkout session", async () => {
  const response = await POST(request(JSON.stringify({ padding: "x".repeat(9000) })));

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "payload_too_large");
  assert.equal(createCalls.length, 0);
});

test("returns a deterministic safe error when Stripe rejects creation", async () => {
  createError = new Error("card account acct_secret and customer cus_private failed");

  const response = await POST(request("{}"));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.deepEqual(body, { ok: false, error: "checkout_unavailable" });
  assert.doesNotMatch(JSON.stringify(body), /acct_secret|cus_private/);
});

test("does not report success without a usable HTTPS Checkout URL", async () => {
  createResult = { url: "http://insecure.example/session" };

  const response = await POST(request("{}"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "checkout_unavailable");
});

test("fails closed when server checkout configuration is absent", async () => {
  delete process.env.STRIPE_PRO_PRICE_ID;
  delete process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;

  const response = await POST(request("{}"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "checkout_not_configured");
  assert.equal(createCalls.length, 0);
});


test("pricing client always delegates plan selection to the server boundary", () => {
  const pricingSource = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../components/marketing/PricingTable.tsx",
    ),
    "utf8",
  );

  assert.match(pricingSource, /fetch\("\/api\/stripe\/checkout"/);
  assert.match(pricingSource, /body:\s*JSON\.stringify\(\{\}\)/);
  assert.doesNotMatch(pricingSource, /NEXT_PUBLIC_STRIPE_PRO_PRICE_ID/);
  assert.doesNotMatch(pricingSource, /if\s*\(!PRO_PRICE_ID\)/);
});
