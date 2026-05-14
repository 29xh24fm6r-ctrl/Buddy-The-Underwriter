import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPROCESS_ROUTE = resolve(
  process.cwd(),
  "src/app/api/deals/[dealId]/reprocess/route.ts",
);

test("[reprocess-fanout-1] handleExtractAll references fanOutDocExtraction", () => {
  const src = readFileSync(REPROCESS_ROUTE, "utf8");

  // Locate handleExtractAll function boundary
  const start = src.indexOf("async function handleExtractAll");
  assert.ok(start >= 0, "handleExtractAll must exist");

  // Find the next async function declaration to bound the search window
  const nextFn = src.indexOf("async function handle", start + 30);
  const end = nextFn > start ? nextFn : src.length;
  const handleExtractAllBody = src.slice(start, end);

  assert.match(
    handleExtractAllBody,
    /fanOutDocExtraction/,
    "handleExtractAll must call fanOutDocExtraction after queueing events",
  );
});

test("[reprocess-fanout-2] handleExtractAll uses fire-and-forget pattern", () => {
  const src = readFileSync(REPROCESS_ROUTE, "utf8");
  const start = src.indexOf("async function handleExtractAll");
  const nextFn = src.indexOf("async function handle", start + 30);
  const end = nextFn > start ? nextFn : src.length;
  const handleExtractAllBody = src.slice(start, end);

  // Must use `void` keyword to mark intentional fire-and-forget
  assert.match(
    handleExtractAllBody,
    /void\s+fanOutDocExtraction/,
    "fan-out must be fire-and-forget (void operator)",
  );
});
