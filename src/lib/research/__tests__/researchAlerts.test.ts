/**
 * Tests for sendResearchCriticalAlert.
 *
 * Same inline fake Supabase pattern as
 * src/lib/observability/__tests__/sendBankerAnalysisAlert.test.ts for the
 * cooldown/dedup logic, but this module targets Chatto (Buddy's internal
 * comms tool), not Slack — see researchAlerts.ts's top-of-file note on why
 * the payload is a plain generic JSON body rather than Slack Block Kit.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { sendResearchCriticalAlert, RESEARCH_ALERT_SENT_KIND } from "../researchAlerts";

type Row = Record<string, any>;

function fakeSb(initial: Row[] = []) {
  const rows: Row[] = initial.slice();
  const inserts: Row[] = [];

  function builder() {
    let action: "select" | "insert" = "select";
    let _insertRow: Row | null = null;
    const filters: Array<(r: Row) => boolean> = [];
    let _limit = Infinity;

    const chain: any = {
      select() { return chain; },
      insert(row: Row) { action = "insert"; _insertRow = row; return chain; },
      gte(col: string, val: string) { filters.push((r) => String(r[col] ?? "") >= val); return chain; },
      eq(col: string, val: any) {
        if (col.startsWith("payload->>")) {
          const key = col.slice("payload->>".length);
          filters.push((r) => (r.payload ?? {})[key] === val);
        } else {
          filters.push((r) => r[col] === val);
        }
        return chain;
      },
      limit(n: number) { _limit = n; return chain; },
      then(onF: any, onR?: any) { return resolve().then(onF, onR); },
    };

    function resolve() {
      if (action === "insert" && _insertRow) {
        const stamped = { id: `id_${Math.random().toString(36).slice(2, 12)}`, created_at: new Date().toISOString(), ..._insertRow };
        rows.push(stamped);
        inserts.push(stamped);
        return Promise.resolve({ data: stamped, error: null });
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: matched.slice(0, _limit), error: null });
    }

    return chain;
  }

  return { sb: { from: () => builder() } as any, inserts, rows };
}

function fakeFetch(opts: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; body: any }> = [];
  const fn = (async (url: any, init?: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok: opts.ok !== false, status: opts.status ?? 200 } as any;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const INPUT = { missionId: "m-1", dealId: "deal-1", gateId: "bie_exception", reason: "Buddy Intelligence Engine threw before completion: boom" };
const CHATTO_URL = "https://chatto.internal.test/webhook/abc";

test("missing CHATTO_WEBHOOK_URL → alert_not_configured (no throw)", async () => {
  const { sb } = fakeSb();
  const { fn } = fakeFetch();
  const r = await sendResearchCriticalAlert({ ...INPUT, _deps: { sb, fetchImpl: fn, webhookUrl: null } });
  assert.equal(r.sent, false);
  assert.equal(r.reason, "alert_not_configured");
});

test("happy path → posts to Chatto and writes a dedupe row", async () => {
  const { sb, inserts } = fakeSb();
  const { fn, calls } = fakeFetch();
  const r = await sendResearchCriticalAlert({ ...INPUT, _deps: { sb, fetchImpl: fn, webhookUrl: CHATTO_URL } });
  assert.equal(r.sent, true);
  assert.equal(r.reason, "ok");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, CHATTO_URL);
  assert.match(calls[0].body.text, /bie_exception/);
  // Plain generic body — no Slack-specific Block Kit structure.
  assert.equal("blocks" in calls[0].body, false);

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].payload.kind, RESEARCH_ALERT_SENT_KIND);
  assert.equal(inserts[0].payload.alert_id, "m-1:bie_exception");
  assert.equal(inserts[0].payload.mission_id, "m-1");
  assert.equal(inserts[0].payload.deal_id, "deal-1");
});

test("second alert for the same mission+gate within the cooldown window is suppressed", async () => {
  const now = new Date("2026-07-13T12:00:00Z");
  const { sb } = fakeSb([
    {
      created_at: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      payload: { kind: RESEARCH_ALERT_SENT_KIND, alert_id: "m-1:bie_exception" },
    },
  ]);
  const { fn, calls } = fakeFetch();
  const r = await sendResearchCriticalAlert({ ...INPUT, _deps: { sb, fetchImpl: fn, webhookUrl: CHATTO_URL, now } });
  assert.equal(r.sent, false);
  assert.equal(r.reason, "cooldown");
  assert.equal(calls.length, 0, "should not have posted to Chatto again");
});

test("a different mission+gate is not suppressed by another mission's recent alert", async () => {
  const now = new Date("2026-07-13T12:00:00Z");
  const { sb } = fakeSb([
    {
      created_at: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      payload: { kind: RESEARCH_ALERT_SENT_KIND, alert_id: "m-OTHER:bie_exception" },
    },
  ]);
  const { fn, calls } = fakeFetch();
  const r = await sendResearchCriticalAlert({ ...INPUT, _deps: { sb, fetchImpl: fn, webhookUrl: CHATTO_URL, now } });
  assert.equal(r.sent, true);
  assert.equal(calls.length, 1);
});

test("Chatto non-2xx response → chatto_failed, not sent", async () => {
  const { sb } = fakeSb();
  const { fn } = fakeFetch({ ok: false, status: 500 });
  const r = await sendResearchCriticalAlert({ ...INPUT, _deps: { sb, fetchImpl: fn, webhookUrl: CHATTO_URL } });
  assert.equal(r.sent, false);
  assert.equal(r.reason, "chatto_failed");
  assert.match(r.detail ?? "", /500/);
});
