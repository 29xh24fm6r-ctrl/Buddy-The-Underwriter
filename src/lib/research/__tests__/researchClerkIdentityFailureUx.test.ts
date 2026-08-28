import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("research mission actor identity compatibility", () => {
  const migration = read(
    "supabase/migrations/20260828195000_research_mission_clerk_actor.sql",
  );

  it("removes the obsolete Supabase Auth UUID foreign key", () => {
    assert.match(
      migration,
      /drop constraint if exists buddy_research_missions_created_by_fkey/i,
    );
  });

  it("stores Clerk and legacy actor identifiers without destructive rewriting", () => {
    assert.match(migration, /alter column created_by type text/i);
    assert.match(migration, /using created_by::text/i);
  });
});

describe("research launch failure UX", () => {
  const workbench = read("src/components/underwrite/AnalystWorkbench.tsx");

  it("checks the POST response instead of swallowing non-2xx results", () => {
    assert.match(workbench, /readResearchRunFailure\(response\)/);
    assert.match(workbench, /if \(response\.ok\) return null/);
  });

  it("surfaces backend details and correlation IDs in an alert", () => {
    assert.match(workbench, /payload\.detail, payload\.error, payload\.message/);
    assert.match(workbench, /x-correlation-id/);
    assert.match(workbench, /role="alert"/);
    assert.match(workbench, /Research could not start\./);
  });

  it("still refreshes both research and underwriting state after every attempt", () => {
    assert.match(
      workbench,
      /Promise\.allSettled\(\[fetchResearch\(\), fetchState\(\)\]\)/,
    );
  });
});
