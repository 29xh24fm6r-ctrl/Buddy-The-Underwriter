import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileReminderAttempts } from "../reconcileAttempts";

test("reconcileReminderAttempts deduplicates the two ledgers by provider SID", () => {
  const result = reconcileReminderAttempts({
    events: [
      {
        created_at: "2026-08-29T12:00:01.000Z",
        payload: { sid: "SM-1" },
      },
    ],
    outbound: [
      {
        created_at: "2026-08-29T12:00:00.000Z",
        provider_message_id: "SM-1",
      },
    ],
  });

  assert.deepEqual(result, {
    attempts: 1,
    lastAt: "2026-08-29T12:00:01.000Z",
  });
});

test("reconcileReminderAttempts preserves a send present in only one ledger", () => {
  const result = reconcileReminderAttempts({
    events: [
      {
        created_at: "2026-08-27T12:00:00.000Z",
        payload: { sid: "SM-event-only" },
      },
    ],
    outbound: [
      {
        created_at: "2026-08-29T12:00:00.000Z",
        provider_message_id: "SM-outbound-only",
      },
    ],
  });

  assert.deepEqual(result, {
    attempts: 2,
    lastAt: "2026-08-29T12:00:00.000Z",
  });
});

test("reconcileReminderAttempts returns empty stats when neither ledger has sends", () => {
  assert.deepEqual(
    reconcileReminderAttempts({ events: [], outbound: [] }),
    { attempts: 0, lastAt: null },
  );
});

test("reconcileReminderAttempts fails closed on malformed authoritative evidence", () => {
  assert.throws(
    () =>
      reconcileReminderAttempts({
        events: [
          {
            created_at: "2026-08-29T12:00:00.000Z",
            payload: {},
          },
        ],
        outbound: [],
      }),
    /missing provider sid/,
  );

  assert.throws(
    () =>
      reconcileReminderAttempts({
        events: [],
        outbound: [
          {
            created_at: "not-a-date",
            provider_message_id: "SM-2",
          },
        ],
      }),
    /invalid created_at/,
  );
});
