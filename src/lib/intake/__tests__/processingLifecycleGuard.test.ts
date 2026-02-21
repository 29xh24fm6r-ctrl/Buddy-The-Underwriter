/**
 * Processing Lifecycle CI Guards
 *
 * Structural invariants for the intake processing lifecycle.
 * These guards CI-lock critical constants and behavioral contracts
 * that must never change without explicit architectural approval.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PROCESSING_WINDOW_MS,
  PROCESSING_VERSION,
  POLL_INITIAL_MS,
  POLL_BACKOFF_MS,
  POLL_MAX_MS,
} from "../constants";

describe("Processing Lifecycle CI Guards", () => {
  // Guard 1: MAX_PROCESSING_WINDOW_MS is exactly 5 minutes
  test("Guard 1: MAX_PROCESSING_WINDOW_MS = 300_000 (5 minutes)", () => {
    assert.equal(
      MAX_PROCESSING_WINDOW_MS,
      5 * 60 * 1000,
      "MAX_PROCESSING_WINDOW_MS must be exactly 5 minutes (300,000ms)",
    );
  });

  // Guard 2: PROCESSING_VERSION is a non-empty string starting with "processing_"
  test("Guard 2: PROCESSING_VERSION is versioned", () => {
    assert.ok(
      typeof PROCESSING_VERSION === "string" && PROCESSING_VERSION.length > 0,
      "PROCESSING_VERSION must be a non-empty string",
    );
    assert.ok(
      PROCESSING_VERSION.startsWith("processing_"),
      "PROCESSING_VERSION must start with 'processing_'",
    );
  });

  // Guard 3: Polling backoff order is monotonically increasing
  test("Guard 3: Polling intervals are monotonically increasing", () => {
    assert.ok(
      POLL_INITIAL_MS < POLL_BACKOFF_MS,
      `POLL_INITIAL_MS (${POLL_INITIAL_MS}) must be < POLL_BACKOFF_MS (${POLL_BACKOFF_MS})`,
    );
    assert.ok(
      POLL_BACKOFF_MS < POLL_MAX_MS,
      `POLL_BACKOFF_MS (${POLL_BACKOFF_MS}) must be < POLL_MAX_MS (${POLL_MAX_MS})`,
    );
  });

  // Guard 4: Polling intervals are within sane bounds
  test("Guard 4: Polling intervals are within sane bounds", () => {
    assert.ok(
      POLL_INITIAL_MS >= 1_000 && POLL_INITIAL_MS <= 5_000,
      `POLL_INITIAL_MS (${POLL_INITIAL_MS}) must be between 1s and 5s`,
    );
    assert.ok(
      POLL_MAX_MS >= 5_000 && POLL_MAX_MS <= 30_000,
      `POLL_MAX_MS (${POLL_MAX_MS}) must be between 5s and 30s`,
    );
  });
});
