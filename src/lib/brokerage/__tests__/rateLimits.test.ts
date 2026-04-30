import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// Shim server-only, next/headers, and supabaseAdmin before loading the
// module. We inject a mock increment_rate_counter so the tests are pure
// in-memory and never hit a DB.

mockServerOnly();
const require = createRequire(import.meta.url);

// ─── Shared mock state ────────────────────────────────────────────────
type RpcFn = (name: string, args: any) => Promise<{ data: any; error: any }>;

const mockState: {
  counters: Map<string, number>;
  nextRpcError: string | null;
} = {
  counters: new Map(),
  nextRpcError: null,
};

const mockRpc: RpcFn = async (name, args) => {
  if (mockState.nextRpcError) {
    const err = mockState.nextRpcError;
    mockState.nextRpcError = null;
    return { data: null, error: { message: err } };
  }
  if (name !== "increment_rate_counter") {
    return { data: null, error: { message: "unknown rpc" } };
  }
  const key = String(args.p_key);
  const next = (mockState.counters.get(key) ?? 0) + 1;
  mockState.counters.set(key, next);
  return { data: next, error: null };
};

// Stub next/headers with configurable IP header.
let mockIp = "1.2.3.4";
require.cache[require.resolve("next/headers")] = {
  id: "next/headers-stub",
  filename: "next/headers-stub",
  loaded: true,
  exports: {
    headers: async () => ({
      get: (name: string) => {
        if (name === "x-forwarded-for") return mockIp;
        return null;
      },
    }),
  },
} as any;

// Stub @/lib/supabase/admin.
require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "supabase-admin-stub",
  filename: "supabase-admin-stub",
  loaded: true,
  exports: { supabaseAdmin: () => ({ rpc: mockRpc }) },
} as any;

const { checkConciergeRateLimit } =
  require("../rateLimits") as typeof import("../rateLimits");

function resetMocks(ip = "1.2.3.4") {
  mockState.counters.clear();
  mockState.nextRpcError = null;
  mockIp = ip;
}

// ─── Tests ────────────────────────────────────────────────────────────

test("happy path: first call within all windows returns allowed", async () => {
  resetMocks();
  const r = await checkConciergeRateLimit({ tokenHash: null });
  assert.equal(r.allowed, true);
});

test("IP-minute limit: 6th call in same 60s window returns 429 with retry-after >= 1", async () => {
  resetMocks("10.0.0.1");
  // 5 allowed.
  for (let i = 0; i < 5; i++) {
    const r = await checkConciergeRateLimit({ tokenHash: null });
    assert.equal(r.allowed, true);
  }
  // 6th exceeds.
  const r6 = await checkConciergeRateLimit({ tokenHash: null });
  assert.equal(r6.allowed, false);
  if (r6.allowed === false) {
    assert.equal(r6.reason, "ip_rate_limit_minute");
    assert.ok(r6.retryAfterSeconds >= 1);
  }
});

test("session-minute limit: 11th call in 60s for same token returns 429", async () => {
  resetMocks();
  const token = "a".repeat(64);
  // Rotate IPs so the per-IP minute counter never trips — we want the
  // session counter to be the only one advancing for this test.
  for (let i = 0; i < 10; i++) {
    mockIp = `10.1.0.${i}`;
    const r = await checkConciergeRateLimit({ tokenHash: token });
    assert.equal(r.allowed, true, `call ${i + 1} should be allowed`);
  }
  mockIp = "10.1.0.99";
  const r11 = await checkConciergeRateLimit({ tokenHash: token });
  assert.equal(r11.allowed, false);
  if (r11.allowed === false) {
    assert.equal(r11.reason, "session_rate_limit_minute");
  }
});

test("fail-open: rpc error returns allowed=true and logs warn", async () => {
  resetMocks("10.0.0.3");
  mockState.nextRpcError = "counter simulated failure";
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const r = await checkConciergeRateLimit({ tokenHash: null });
    assert.equal(r.allowed, true);
    assert.ok(
      warnings.some((w) => w.includes("[rate-limit] counter failed")),
      "expected fail-open warn log",
    );
  } finally {
    console.warn = origWarn;
  }
});

test("no tokenHash: only IP-scope checks run (session counters untouched)", async () => {
  resetMocks("10.0.0.4");
  const r = await checkConciergeRateLimit({ tokenHash: null });
  assert.equal(r.allowed, true);
  const sessKeys = Array.from(mockState.counters.keys()).filter((k) =>
    k.startsWith("rl:sess:"),
  );
  assert.equal(sessKeys.length, 0);
});

test("IP-hour limit: 31 calls in 60 minutes returns 429 with reason ip_rate_limit_hour", async () => {
  resetMocks("10.0.0.5");
  // First we need to burn 30 without tripping the minute limit (max 5 per
  // minute). The mock has a single shared counter per key, so calling the
  // minute-scoped key 30 times will exceed the 5-per-minute limit well
  // before the hour limit matters. Instead, seed the hour counter directly
  // past its threshold — that's how prod would look after sustained traffic.
  const windowSeconds = 3600;
  const windowStart =
    Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  mockState.counters.set(`rl:ip:10.0.0.5:hour:${windowStart}`, 30);

  // Trip the minute/day counters but not re-trip minute before hour.
  // The ordered check is minute → hour → day. Setting minute counter to 0
  // and hour counter to 30 means a fresh call: minute becomes 1 (pass),
  // hour becomes 31 (fail).
  const r = await checkConciergeRateLimit({ tokenHash: null });
  assert.equal(r.allowed, false);
  if (r.allowed === false) {
    assert.equal(r.reason, "ip_rate_limit_hour");
  }
});
