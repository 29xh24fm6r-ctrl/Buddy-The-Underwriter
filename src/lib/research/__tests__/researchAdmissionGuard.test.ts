/**
 * Research admission: the mission row must exist before the 202.
 *
 * The underwrite page reads buddy_research_missions. When the row was only
 * inserted inside the durable workflow step, the panel stayed empty after
 * "Run Research" until the banker refreshed. Guard the contract at the
 * source level (the modules are server-only and drive a real workflow).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("startResearchMission resolves the mission row before starting the workflow", () => {
  const src = read("src/lib/research/startResearchMission.ts");
  const prepareAt = src.indexOf("await prepareMissionRun(");
  const startAt = src.indexOf("await start(researchMissionWorkflow");
  assert.ok(prepareAt > 0 && startAt > prepareAt, "prepareMissionRun must run before start()");
  assert.match(src, /missionId: prepared\.missionId/, "the workflow must adopt the pre-created mission");
  assert.match(src, /failMissionAdmission\(prepared\.missionId/, "a workflow that cannot start must fail the queued row");
  assert.match(src, /duplicate: true, mission_id: prepared\.missionId/, "duplicates are reported, not re-run");
});

test("runMission adopts a pre-resolved missionId instead of creating a second row", () => {
  const src = read("src/lib/research/runMission.ts");
  assert.match(src, /export async function prepareMissionRun\(/);
  assert.match(src, /if \(opts\?\.missionId\) \{[\s\S]*?missionId = opts\.missionId;/);
  assert.match(src, /getResumeDecision\(supabaseAdmin\(\), missionId\)/, "adopted missions resume from their checkpoints");
});

test("the stale-mission sweep also recovers rows never picked up from queued", () => {
  const checkpoint = read("src/lib/research/checkpoint.ts");
  assert.match(checkpoint, /\.eq\("status", "queued"\)\s*\.lt\("created_at", threshold\)/);
  const sweep = read("src/lib/research/staleMissionSweep.ts");
  assert.match(sweep, /\.in\("status", \["running", "queued"\]\)/);
});
