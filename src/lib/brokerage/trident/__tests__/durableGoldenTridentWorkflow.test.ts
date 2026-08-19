import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/brokerage/deals/[dealId]/trident/generate/route.ts", "utf8");
const workflow = readFileSync("src/workflows/goldenTrident.ts", "utf8");
const generator = readFileSync("src/lib/brokerage/trident/generateTridentBundle.ts", "utf8");
const client = readFileSync("src/components/brokerage/GoldenTridentLabClient.tsx", "utf8");
const nextConfig = readFileSync("next.config.mjs", "utf8");

test("final Trident generation is accepted into a durable workflow", () => {
  assert.match(route, /start\(goldenTridentWorkflow/);
  assert.match(route, /status:\s*202/);
  assert.doesNotMatch(route, /await generateTridentBundle/);
  assert.match(workflow, /"use workflow"/);
  assert.match(workflow, /"use step"/);
  assert.match(nextConfig, /withWorkflow\(nextConfig\)/);
});

test("workflow retries are idempotent and abandoned runs are recoverable", () => {
  assert.match(workflow, /bundleId:\s*string/);
  assert.match(workflow, /generateTridentBundle\(args\)/);
  assert.match(generator, /bundleId\?: string/);
  assert.match(generator, /Generation worker stopped before completion/);
  assert.match(generator, /20 \* 60 \* 1000/);
  assert.match(route, /Workflow start failed/);
});

test("the quality lab polls persisted state instead of holding the request open", () => {
  assert.match(route, /export async function GET/);
  assert.match(client, /waitForTrident/);
  assert.match(client, /method: "GET"/);
  assert.match(client, /running durably in the background/);
  assert.match(client, /bundle\.status === "failed"/);
  assert.match(client, /bundle\.status === "succeeded"/);
});
