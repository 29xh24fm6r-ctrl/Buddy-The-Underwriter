import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  BUDDY_SIGNAL_ACTIVE_POLL_MS,
  BUDDY_SIGNAL_ERROR_POLL_MAX_MS,
  BUDDY_SIGNAL_IDLE_POLL_MAX_MS,
  BUDDY_SIGNAL_ROUTE_TIMEOUT_MS,
  getBuddySignalPollDelay,
} from "@/buddy/serverSignalPolling";

const ROOT = process.cwd();
const POLLER = fs.readFileSync(
  path.join(ROOT, "src/buddy/useBuddyServerSignals.ts"),
  "utf8",
);
const ROUTE = fs.readFileSync(
  path.join(ROOT, "src/app/api/buddy/signals/latest/route.ts"),
  "utf8",
);

describe("Buddy server signal polling resilience", () => {
  it("backs off idle reads from the active interval to the idle cap", () => {
    assert.equal(
      getBuddySignalPollDelay({
        consecutiveErrors: 0,
        consecutiveEmptyPolls: 0,
      }),
      BUDDY_SIGNAL_ACTIVE_POLL_MS,
    );
    assert.equal(
      getBuddySignalPollDelay({
        consecutiveErrors: 0,
        consecutiveEmptyPolls: 1,
      }),
      5_000,
    );
    assert.equal(
      getBuddySignalPollDelay({
        consecutiveErrors: 0,
        consecutiveEmptyPolls: 10,
      }),
      BUDDY_SIGNAL_IDLE_POLL_MAX_MS,
    );
  });

  it("backs off failures independently and caps the retry interval", () => {
    assert.equal(
      getBuddySignalPollDelay({
        consecutiveErrors: 1,
        consecutiveEmptyPolls: 0,
      }),
      5_000,
    );
    assert.equal(
      getBuddySignalPollDelay({
        consecutiveErrors: 10,
        consecutiveEmptyPolls: 10,
      }),
      BUDDY_SIGNAL_ERROR_POLL_MAX_MS,
    );
  });

  it("suspends hidden tabs and cancels in-flight reads", () => {
    assert.match(POLLER, /document\.hidden/);
    assert.match(POLLER, /visibilitychange/);
    assert.match(POLLER, /inflight\?\.abort\(\)/);
    assert.match(POLLER, /BUDDY_SIGNAL_FETCH_TIMEOUT_MS/);
  });

  it("uses a strict cursor and a deadline below the function ceiling", () => {
    assert.match(ROUTE, /q\s*=\s*q\.gt\("created_at",\s*since\)/);
    assert.doesNotMatch(ROUTE, /q\s*=\s*q\.gte\("created_at",\s*since\)/);
    assert.match(ROUTE, /\.abortSignal\(signal\)/);
    assert.ok(BUDDY_SIGNAL_ROUTE_TIMEOUT_MS < 15_000);
    assert.match(ROUTE, /status:\s*503/);
    assert.match(ROUTE, /"Retry-After":\s*"10"/);
  });
});
