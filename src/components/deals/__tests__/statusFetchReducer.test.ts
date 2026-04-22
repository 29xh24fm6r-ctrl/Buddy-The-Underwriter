import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFetchOutcome,
  isReady,
  isFailed,
  buttonMode,
  type StatusFetchState,
  type FetchOutcome,
} from "../statusFetchReducer";

// ─── Spec D5 — StatusFetchState transition tests ─────────────────────────────

describe("applyFetchOutcome — state transitions", () => {
  it("'start' → loading", () => {
    assert.deepEqual(applyFetchOutcome({ type: "start" }), { kind: "loading" });
  });

  it("'network_error' → failed with the given error and canRetry:true", () => {
    const state = applyFetchOutcome({
      type: "network_error",
      error: "fetch failed",
    });
    assert.equal(state.kind, "failed");
    if (state.kind === "failed") {
      assert.equal(state.error, "fetch failed");
      assert.equal(state.canRetry, true);
    }
  });

  it("'http_error' → failed with 'Status check failed (NNN)'", () => {
    const state = applyFetchOutcome({ type: "http_error", status: 504 });
    assert.equal(state.kind, "failed");
    if (state.kind === "failed") {
      assert.equal(state.error, "Status check failed (504)");
      assert.equal(state.canRetry, true);
    }
  });

  it("'payload_error' → failed with the payload error message", () => {
    const state = applyFetchOutcome({
      type: "payload_error",
      error: "forbidden",
    });
    assert.equal(state.kind, "failed");
    if (state.kind === "failed") {
      assert.equal(state.error, "forbidden");
    }
  });

  it("'success' → ready with the payload as status", () => {
    const payload = { eligibleDocuments: 9, hasNewPromptVersion: true };
    const state = applyFetchOutcome<typeof payload>({
      type: "success",
      data: payload,
    });
    assert.equal(state.kind, "ready");
    if (state.kind === "ready") {
      assert.deepEqual(state.status, payload);
    }
  });
});

describe("applyFetchOutcome — full lifecycle", () => {
  it("loading → failed → loading → ready (retry-after-failure path)", () => {
    // This models what the UI does: kick off a fetch (loading), fetch fails
    // (failed), user clicks retry (loading again), fetch succeeds (ready).
    // Spec D5's core promise is that the failed → loading transition is
    // always available: the button can never be stuck.
    let state: StatusFetchState<{ eligibleDocuments: number }> = { kind: "idle" };

    state = applyFetchOutcome({ type: "start" });
    assert.equal(state.kind, "loading");

    state = applyFetchOutcome({ type: "http_error", status: 504 });
    assert.equal(state.kind, "failed");

    state = applyFetchOutcome({ type: "start" });
    assert.equal(state.kind, "loading");

    state = applyFetchOutcome({
      type: "success",
      data: { eligibleDocuments: 9 },
    });
    assert.equal(state.kind, "ready");
    if (state.kind === "ready") {
      assert.equal(state.status.eligibleDocuments, 9);
    }
  });

  it("idle → loading → ready (happy path)", () => {
    let state: StatusFetchState<{ eligibleDocuments: number }> = { kind: "idle" };
    state = applyFetchOutcome({ type: "start" });
    state = applyFetchOutcome({
      type: "success",
      data: { eligibleDocuments: 0 },
    });
    assert.equal(state.kind, "ready");
  });

  it("once 'failed', the next 'start' clears the failure and goes back to loading", () => {
    const failed = applyFetchOutcome<{ n: number }>({
      type: "network_error",
      error: "boom",
    });
    assert.equal(failed.kind, "failed");
    const next = applyFetchOutcome<{ n: number }>({ type: "start" });
    assert.equal(next.kind, "loading");
    // The reducer is stateless — prior failure does not leak into the next state.
  });
});

describe("narrowing helpers", () => {
  it("isReady narrows correctly", () => {
    const s: StatusFetchState<{ n: number }> = { kind: "ready", status: { n: 1 } };
    assert.equal(isReady(s), true);
    if (isReady(s)) {
      assert.equal(s.status.n, 1);
    }
  });

  it("isReady returns false for non-ready states", () => {
    assert.equal(isReady({ kind: "idle" }), false);
    assert.equal(isReady({ kind: "loading" }), false);
    assert.equal(
      isReady({ kind: "failed", error: "x", canRetry: true } as StatusFetchState<unknown>),
      false,
    );
  });

  it("isFailed narrows correctly and returns false for other states", () => {
    assert.equal(
      isFailed({ kind: "failed", error: "x", canRetry: true } as StatusFetchState<unknown>),
      true,
    );
    assert.equal(isFailed({ kind: "loading" }), false);
    assert.equal(
      isFailed({ kind: "ready", status: { n: 1 } } as StatusFetchState<{ n: number }>),
      false,
    );
  });
});

describe("buttonMode — button render branch selection", () => {
  it("pending takes precedence over every state", () => {
    assert.equal(buttonMode<unknown>({ kind: "idle" }, true), "pending");
    assert.equal(buttonMode<unknown>({ kind: "loading" }, true), "pending");
    assert.equal(
      buttonMode<{ n: number }>({ kind: "ready", status: { n: 1 } }, true),
      "pending",
    );
    assert.equal(
      buttonMode<unknown>({ kind: "failed", error: "x", canRetry: true }, true),
      "pending",
    );
  });

  it("failed returns 'failed' when not pending", () => {
    assert.equal(
      buttonMode<unknown>({ kind: "failed", error: "x", canRetry: true }, false),
      "failed",
    );
  });

  it("idle and loading both return 'loading' when not pending", () => {
    assert.equal(buttonMode<unknown>({ kind: "idle" }, false), "loading");
    assert.equal(buttonMode<unknown>({ kind: "loading" }, false), "loading");
  });

  it("ready returns 'ready' when not pending", () => {
    assert.equal(
      buttonMode<{ n: number }>({ kind: "ready", status: { n: 1 } }, false),
      "ready",
    );
  });
});

describe("Spec D5 core guarantee: button is never permanently stuck", () => {
  it("every non-ready state either is retry-able or is loading", () => {
    // For every state type produced by applyFetchOutcome, either:
    //   (a) it's "ready" (user can click the main action),
    //   (b) it's "loading" (transient, will resolve), or
    //   (c) it's "failed" with canRetry:true (user can click retry).
    // There is no "dead-end" state variant.
    const outcomes: FetchOutcome<{ n: number }>[] = [
      { type: "start" },
      { type: "network_error", error: "x" },
      { type: "http_error", status: 500 },
      { type: "payload_error", error: "x" },
      { type: "success", data: { n: 1 } },
    ];
    for (const o of outcomes) {
      const s = applyFetchOutcome(o);
      const recoverable =
        s.kind === "ready" ||
        s.kind === "loading" ||
        (s.kind === "failed" && s.canRetry === true);
      assert.equal(
        recoverable,
        true,
        `outcome ${o.type} produced a dead-end state: ${JSON.stringify(s)}`,
      );
    }
  });
});
