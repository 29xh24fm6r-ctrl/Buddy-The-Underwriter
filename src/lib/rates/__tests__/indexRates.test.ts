import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const {
  getLatestIndexRates,
  __resetIndexRatesCacheForTests,
  RateFeedUnavailableError,
} = require("../indexRates") as typeof import("../indexRates");

const originalFetch = globalThis.fetch;
let now = Date.now();

function today(offsetDays = 0): string {
  return new Date(now + offsetDays * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

function installOfficialFeedMock(options?: {
  primaryStatus?: number;
  ratePct?: number;
}) {
  const primaryStatus = options?.primaryStatus ?? 200;
  const ratePct = options?.ratePct ?? 4.25;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("markets.newyorkfed.org")) {
      return new Response(
        primaryStatus === 200
          ? JSON.stringify({
              refRates: [{ effectiveDate: today(), percentRate: ratePct }],
            })
          : "unavailable",
        { status: primaryStatus },
      );
    }
    if (url.includes("home.treasury.gov")) {
      return new Response(
        primaryStatus === 200
          ? `<feed><entry><content><m:properties>
              <d:NEW_DATE>${today()}T00:00:00</d:NEW_DATE>
              <d:BC_5YEAR>${ratePct}</d:BC_5YEAR>
            </m:properties></content></entry></feed>`
          : "unavailable",
        { status: primaryStatus },
      );
    }
    if (url.includes("fredgraph.csv")) {
      const series = new URL(url).searchParams.get("id");
      const value =
        series === "DPRIME" ? ratePct + 3 : series === "SOFR" ? ratePct + 1 : ratePct;
      return new Response(`observation_date,${series}\n${today()},${value}\n`);
    }
    return new Response("unexpected URL", { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  __resetIndexRatesCacheForTests();
  now = Date.now();
  installOfficialFeedMock();
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("loads benchmark truth from the three official deterministic feeds", async () => {
  const rates = await getLatestIndexRates();

  assert.equal(rates.SOFR.ratePct, 4.25);
  assert.equal(rates.SOFR.source, "nyfed");
  assert.equal(rates.UST_5Y.ratePct, 4.25);
  assert.equal(rates.UST_5Y.source, "treasury");
  assert.equal(rates.PRIME.ratePct, 7.25);
  assert.equal(rates.PRIME.source, "fred");
  assert.match(rates.SOFR.sourceUrl ?? "", /markets\.newyorkfed\.org/);
  assert.match(rates.UST_5Y.sourceUrl ?? "", /home\.treasury\.gov/);
});

test("falls back to Federal Reserve series when NY Fed or Treasury is unavailable", async () => {
  installOfficialFeedMock({ primaryStatus: 503 });

  const rates = await getLatestIndexRates();

  assert.equal(rates.SOFR.ratePct, 5.25);
  assert.equal(rates.SOFR.source, "fred");
  assert.equal(rates.UST_5Y.ratePct, 4.25);
  assert.equal(rates.UST_5Y.source, "fred");
  assert.equal(rates.PRIME.ratePct, 7.25);
});

test("rejects implausible observations instead of admitting bad pricing inputs", async () => {
  installOfficialFeedMock({ ratePct: 99 });

  await assert.rejects(
    () => getLatestIndexRates(),
    (error: unknown) => error instanceof RateFeedUnavailableError,
  );
});

test("rejects stale observations from every provider", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const staleDate = today(-30);
    if (url.includes("markets.newyorkfed.org")) {
      return new Response(
        JSON.stringify({
          refRates: [{ effectiveDate: staleDate, percentRate: 4.25 }],
        }),
      );
    }
    if (url.includes("home.treasury.gov")) {
      return new Response(
        `<feed><entry><d:NEW_DATE>${staleDate}T00:00:00</d:NEW_DATE><d:BC_5YEAR>4.25</d:BC_5YEAR></entry></feed>`,
      );
    }
    return new Response(`observation_date,value\n${staleDate},4.25\n`);
  }) as typeof fetch;

  await assert.rejects(
    () => getLatestIndexRates(),
    (error: unknown) => error instanceof RateFeedUnavailableError,
  );
});

test("serves bounded last-known-good rates when a refresh fails", async () => {
  const first = await getLatestIndexRates();
  assert.equal(first.SOFR.raw, undefined);

  now += 16 * 60 * 1_000;
  const originalDateNow = Date.now;
  Date.now = () => now;
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;

  try {
    const stale = await getLatestIndexRates();
    assert.equal(stale.SOFR.ratePct, first.SOFR.ratePct);
    assert.deepEqual(stale.SOFR.raw, {
      stale: true,
      reason: "official_refresh_failed",
      lastKnownSource: "nyfed",
    });
  } finally {
    Date.now = originalDateNow;
  }
});
