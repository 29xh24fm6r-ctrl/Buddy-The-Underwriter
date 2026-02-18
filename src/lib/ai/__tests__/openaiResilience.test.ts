import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  OpenAICircuitBreaker,
  isRetryableOpenAIError,
  withOpenAIResilience,
  openAICircuitBreaker,
} from "../openaiResilience";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeError(status: number, message = "error"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function makeNetworkError(message: string): Error {
  return new Error(message);
}

// ─── A) Circuit Breaker ──────────────────────────────────────────────────────

test("circuit breaker: starts in closed state", () => {
  const cb = new OpenAICircuitBreaker();
  assert.equal(cb.state, "closed");
});

test("circuit breaker: recordSuccess resets failure count", () => {
  const cb = new OpenAICircuitBreaker(10, 45_000);
  for (let i = 0; i < 5; i++) cb.recordFailure();
  cb.recordSuccess();
  assert.equal(cb.state, "closed");
});

test("circuit breaker: below threshold stays closed", () => {
  const cb = new OpenAICircuitBreaker(10, 45_000);
  for (let i = 0; i < 9; i++) cb.recordFailure();
  assert.equal(cb.state, "closed");
});

test("circuit breaker: at threshold transitions to open", () => {
  const cb = new OpenAICircuitBreaker(10, 45_000);
  for (let i = 0; i < 10; i++) cb.recordFailure();
  assert.equal(cb.state, "open");
});

test("circuit breaker: check() throws OPENAI_CIRCUIT_OPEN when open", () => {
  const cb = new OpenAICircuitBreaker(3, 45_000);
  for (let i = 0; i < 3; i++) cb.recordFailure();
  assert.throws(
    () => cb.check(),
    (err: any) => err.code === "OPENAI_CIRCUIT_OPEN",
  );
});

test("circuit breaker: after cooldown transitions to half-open", () => {
  const cb = new OpenAICircuitBreaker(3, 10); // 10ms cooldown for test
  for (let i = 0; i < 3; i++) cb.recordFailure();
  assert.equal(cb.state, "open");

  // Wait for cooldown
  const start = Date.now();
  while (Date.now() - start < 15) { /* spin */ }

  assert.equal(cb.state, "half-open");
});

test("circuit breaker: half-open success returns to closed", () => {
  const cb = new OpenAICircuitBreaker(3, 10);
  for (let i = 0; i < 3; i++) cb.recordFailure();

  const start = Date.now();
  while (Date.now() - start < 15) { /* spin */ }

  assert.equal(cb.state, "half-open");
  cb.recordSuccess();
  assert.equal(cb.state, "closed");
});

test("circuit breaker: half-open failure re-opens", () => {
  const cb = new OpenAICircuitBreaker(3, 10);
  for (let i = 0; i < 3; i++) cb.recordFailure();

  const start = Date.now();
  while (Date.now() - start < 15) { /* spin */ }

  assert.equal(cb.state, "half-open");
  cb.recordFailure(); // 4th failure, still >= threshold
  assert.equal(cb.state, "open");
});

// ─── B) isRetryableOpenAIError ───────────────────────────────────────────────

test("isRetryableOpenAIError: 500 is retryable", () => {
  assert.ok(isRetryableOpenAIError(makeError(500)));
});

test("isRetryableOpenAIError: 502, 503, 504 are retryable", () => {
  assert.ok(isRetryableOpenAIError(makeError(502)));
  assert.ok(isRetryableOpenAIError(makeError(503)));
  assert.ok(isRetryableOpenAIError(makeError(504)));
});

test("isRetryableOpenAIError: timeout/network errors are retryable", () => {
  assert.ok(isRetryableOpenAIError(makeNetworkError("ECONNRESET")));
  assert.ok(isRetryableOpenAIError(makeNetworkError("ECONNREFUSED")));
  assert.ok(isRetryableOpenAIError(makeNetworkError("ETIMEDOUT")));
  assert.ok(isRetryableOpenAIError(makeNetworkError("socket hang up")));
  assert.ok(isRetryableOpenAIError(makeNetworkError("Request timeout after 45000ms")));
});

test("isRetryableOpenAIError: 400/401/403/404/422 are NOT retryable", () => {
  assert.equal(isRetryableOpenAIError(makeError(400)), false);
  assert.equal(isRetryableOpenAIError(makeError(401)), false);
  assert.equal(isRetryableOpenAIError(makeError(403)), false);
  assert.equal(isRetryableOpenAIError(makeError(404)), false);
  assert.equal(isRetryableOpenAIError(makeError(422)), false);
});

test("isRetryableOpenAIError: 429 is NOT retryable (rate limit handled separately)", () => {
  assert.equal(isRetryableOpenAIError(makeError(429)), false);
});

// ─── C) withOpenAIResilience: Retry behavior ─────────────────────────────────

test("withOpenAIResilience: succeeds on first try, no retry", async () => {
  // Reset singleton breaker
  openAICircuitBreaker._reset();

  let callCount = 0;
  const result = await withOpenAIResilience("test", async () => {
    callCount++;
    return "ok";
  }, { maxRetries: 3 });

  assert.equal(result, "ok");
  assert.equal(callCount, 1);
});

test("withOpenAIResilience: retries on 500, succeeds on attempt 2", async () => {
  openAICircuitBreaker._reset();

  let callCount = 0;
  const result = await withOpenAIResilience("test", async () => {
    callCount++;
    if (callCount === 1) throw makeError(500, "Internal Server Error");
    return "recovered";
  }, { maxRetries: 3 });

  assert.equal(result, "recovered");
  assert.equal(callCount, 2);
});

test("withOpenAIResilience: does NOT retry on 400", async () => {
  openAICircuitBreaker._reset();

  let callCount = 0;
  await assert.rejects(
    () => withOpenAIResilience("test", async () => {
      callCount++;
      throw makeError(400, "Bad Request");
    }, { maxRetries: 3 }),
    (err: any) => err.status === 400,
  );

  assert.equal(callCount, 1);
});

test("withOpenAIResilience: does NOT retry on 429", async () => {
  openAICircuitBreaker._reset();

  let callCount = 0;
  await assert.rejects(
    () => withOpenAIResilience("test", async () => {
      callCount++;
      throw makeError(429, "Rate limited");
    }, { maxRetries: 3 }),
    (err: any) => err.status === 429,
  );

  assert.equal(callCount, 1);
});

test("withOpenAIResilience: exhausts retries and throws last error", async () => {
  openAICircuitBreaker._reset();

  let callCount = 0;
  await assert.rejects(
    () => withOpenAIResilience("test", async () => {
      callCount++;
      throw makeError(502, "Bad Gateway");
    }, { maxRetries: 2 }),
    (err: any) => err.status === 502,
  );

  // 1 initial + 2 retries = 3 total attempts
  assert.equal(callCount, 3);
});

// ─── D) Trace header invariants ──────────────────────────────────────────────

test("withOpenAIResilience: same traceId across retries", async () => {
  openAICircuitBreaker._reset();

  const traceIds: string[] = [];
  let callCount = 0;

  await assert.rejects(
    () => withOpenAIResilience("test", async (ids) => {
      traceIds.push(ids.traceId);
      callCount++;
      throw makeError(500);
    }, { maxRetries: 2 }),
  );

  assert.equal(callCount, 3);
  assert.equal(traceIds[0], traceIds[1]);
  assert.equal(traceIds[1], traceIds[2]);
});

test("withOpenAIResilience: different attemptId per attempt", async () => {
  openAICircuitBreaker._reset();

  const attemptIds: string[] = [];
  let callCount = 0;

  await assert.rejects(
    () => withOpenAIResilience("test", async (ids) => {
      attemptIds.push(ids.attemptId);
      callCount++;
      throw makeError(500);
    }, { maxRetries: 2 }),
  );

  assert.equal(callCount, 3);
  // All attempt IDs must be unique
  const unique = new Set(attemptIds);
  assert.equal(unique.size, 3, "Each attempt must have a unique attemptId");
});

// ─── E) Structural Tripwires ─────────────────────────────────────────────────

function readFile(relativePath: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), relativePath),
    "utf8",
  );
}

test("TRIPWIRE: openaiClient.ts sets maxRetries: 0", () => {
  const src = readFile("src/lib/ai/openaiClient.ts");
  assert.ok(
    src.includes("maxRetries: 0"),
    "openaiClient.ts must set maxRetries: 0 (Buddy owns retries)",
  );
});

test("TRIPWIRE: openaiClient.ts sets timeout", () => {
  const src = readFile("src/lib/ai/openaiClient.ts");
  assert.ok(
    src.includes("timeout:"),
    "openaiClient.ts must set a timeout per attempt",
  );
});

test("TRIPWIRE: openaiClient.ts exports openaiRequestHeaders", () => {
  const src = readFile("src/lib/ai/openaiClient.ts");
  assert.ok(
    src.includes("export function openaiRequestHeaders"),
    "openaiClient.ts must export openaiRequestHeaders for per-request trace IDs",
  );
});

test("TRIPWIRE: classifyWithOpenAI.ts uses withOpenAIResilience for both paths", () => {
  const src = readFile("src/lib/gatekeeper/classifyWithOpenAI.ts");

  // Must import the resilience wrapper
  assert.ok(
    src.includes("withOpenAIResilience"),
    "classifyWithOpenAI.ts must use withOpenAIResilience",
  );

  // Both text and vision functions must use it
  const textIdx = src.indexOf('withOpenAIResilience("gatekeeper_text"');
  const visionIdx = src.indexOf('withOpenAIResilience("gatekeeper_vision"');

  assert.ok(textIdx > 0, "classifyWithOpenAIText must use withOpenAIResilience");
  assert.ok(visionIdx > 0, "classifyWithOpenAIVision must use withOpenAIResilience");
});
