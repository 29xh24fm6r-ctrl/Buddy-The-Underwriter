import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SPEC-RESEARCH-RERUN-ACTION-DISPATCH-FIX-1
 *
 * Prod: Run/Re-run posted to /api/deals/[dealId]/research/rerun and got 500/404
 * because the consolidated dispatcher only knew "run", so no fresh mission
 * started. The dispatcher now aliases rerun/re-run → the run handler.
 *
 * Lives under src/lib/research/__tests__ (not the bracketed [action] dir) because
 * node --test treats bracketed paths as globs and never discovers files there.
 * Reads source files by absolute path — fs handles literal brackets fine.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../.."); // __tests__ → research → lib → src → ROOT
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DISPATCHER = "src/app/api/deals/[dealId]/research/[action]/route.ts";

describe("research POST dispatcher", () => {
  const src = read(DISPATCHER);

  it("routes run AND rerun/re-run aliases to the run handler", () => {
    assert.match(
      src,
      /case "run":\s*\n\s*case "rerun":\s*\n\s*case "re-run":\s*\n\s*return \(await import\("\.\/_handlers\/run"\)\)\.POST/,
    );
  });

  it("still dispatches the run handler (existing behavior intact)", () => {
    assert.match(src, /import\("\.\/_handlers\/run"\)\)\.POST\(req, ctx as any\)/);
  });

  it("unknown actions return JSON not_found, not an opaque error", () => {
    assert.match(src, /\{ ok: false, error: "not_found" \}, \{ status: 404 \}/);
  });
});

describe("run handler returns non-500 JSON for the normal paths", () => {
  const run = read("src/app/api/deals/[dealId]/research/[action]/_handlers/run.ts");
  it("returns already_running JSON when a mission is queued/running", () => {
    assert.match(run, /already_running: true/);
    assert.match(run, /mission_id: existing\.id/);
  });
  it("returns the runMission result (ok + mission_id) on a fresh run", () => {
    assert.match(run, /await runMission\(dealId, missionType, subject/);
    assert.match(run, /NextResponse\.json\(result/);
  });
  it("error path returns JSON, not an opaque body", () => {
    assert.match(run, /\{ ok: false, error: error\?\.message \?\? "unexpected_error" \}/);
  });
});

describe("UI callers post to a supported research action", () => {
  const callers = [
    "src/components/underwrite/AnalystWorkbench.tsx",
    "src/components/creditMemo/RunResearchButton.tsx",
    "src/components/deals/IgniteWizard.tsx",
  ];
  it("every UI research-run POST targets /research/run", () => {
    for (const c of callers) {
      const src = read(c);
      if (/research\/(run|rerun|re-run)/.test(src)) {
        assert.match(src, /\/research\/run/, `${c} should post to /research/run`);
      }
    }
  });
  it("no UI surface hardcodes the legacy /research/rerun path", () => {
    for (const c of callers) {
      const src = read(c);
      assert.doesNotMatch(src, /research\/rerun/, `${c} must not hardcode /research/rerun`);
    }
  });
});
