import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { runRaceHarness, ALL_SCENARIOS } = require("../raceHarness") as typeof import("../raceHarness");
for (const sc of ALL_SCENARIOS) { test(`scenario: ${sc.name}`, async () => { const r = await runRaceHarness({ scenario: sc.name }); assert.equal(r.scenarios[0].ok, true, `FAIL: ${r.scenarios[0].unexpectedMutations.join(", ")}`); }); }
test("full harness", async () => { const r = await runRaceHarness(); assert.equal(r.ok, true); assert.equal(r.total, ALL_SCENARIOS.length); });
