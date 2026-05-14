import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CONCURRENT_EXTRACTIONS } from "@/lib/intake/constants";

test("[concurrency-1] MAX_CONCURRENT_EXTRACTIONS is at least 12", () => {
  assert.ok(
    MAX_CONCURRENT_EXTRACTIONS >= 12,
    `MAX_CONCURRENT_EXTRACTIONS must be >= 12 (got ${MAX_CONCURRENT_EXTRACTIONS})`,
  );
});

test("[concurrency-2] MAX_CONCURRENT_EXTRACTIONS is at most 24 (rate-limit guard)", () => {
  assert.ok(
    MAX_CONCURRENT_EXTRACTIONS <= 24,
    `MAX_CONCURRENT_EXTRACTIONS must be <= 24 to stay well under Gemini rate limits (got ${MAX_CONCURRENT_EXTRACTIONS})`,
  );
});
