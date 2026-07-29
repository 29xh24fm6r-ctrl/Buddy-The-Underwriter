import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCadence, MAX_RUNS_PER_24H } from '../cadenceGuard.js';

function fakePool(runsTrailing24h: number) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    queries,
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT count(*) FROM franchise_sync_runs')) {
        return { rows: [{ count: String(runsTrailing24h) }] };
      }
      if (sql.includes('INSERT INTO buddy_system_events')) {
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('checkCadence: under threshold does not throttle or write anomaly event', async () => {
  const pool = fakePool(2);
  const result = await checkCadence(pool as any);
  assert.equal(result.throttled, false);
  assert.equal(result.runsTrailing24h, 2);
  assert.equal(pool.queries.length, 1, 'should not write an anomaly event');
});

test('checkCadence: over threshold throttles and writes one anomaly event', async () => {
  assert.ok(4 > MAX_RUNS_PER_24H);
  const pool = fakePool(4);
  const result = await checkCadence(pool as any);
  assert.equal(result.throttled, true);
  assert.equal(result.runsTrailing24h, 4);

  const anomalyInserts = pool.queries.filter((q) =>
    q.sql.includes('INSERT INTO buddy_system_events'),
  );
  assert.equal(anomalyInserts.length, 1);
  const payload = JSON.parse(anomalyInserts[0]!.params![0] as string);
  assert.equal(payload.runsTrailing24h, 4);
});

test('checkCadence: exactly at threshold does not throttle', async () => {
  const pool = fakePool(MAX_RUNS_PER_24H);
  const result = await checkCadence(pool as any);
  assert.equal(result.throttled, false);
});
