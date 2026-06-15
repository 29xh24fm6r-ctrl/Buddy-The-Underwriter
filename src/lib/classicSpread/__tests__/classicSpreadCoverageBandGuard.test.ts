import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

const source = fs.readFileSync(
  path.join(repoRoot, "src/lib/classicSpread/classicSpreadRenderer.ts"),
  "utf8",
);

/**
 * BUGFIX (classic-spread render consistency, Patch B).
 *
 * The GCF coverage band (ADEQUATE / TIGHT / DEFICIT) must never render without a numeric global
 * DSCR. Certification can blank globalDscr while leaving coverageStatus set, so the renderer gates
 * the band on `gcf.globalDscr != null` and otherwise falls back to the UNKNOWN band.
 */

test("coverage band derives from a globalDscr-gated status, not raw coverageStatus", () => {
  assert.match(
    source,
    /const coverageStatus = gcf\.globalDscr != null \? gcf\.coverageStatus : "UNKNOWN"/,
    "must compute a gated coverageStatus local",
  );
});

test("the color/label band decisions reference the gated local, not gcf.coverageStatus", () => {
  // The dscr color, accent color, and status label all branch on the gated `coverageStatus`.
  assert.match(source, /dscrColor = coverageStatus === "ADEQUATE"/);
  assert.match(source, /accentColor = coverageStatus === "ADEQUATE"/);
  assert.match(source, /statusLabel = coverageStatus === "ADEQUATE"/);
});

test("no band decision still reads gcf.coverageStatus directly", () => {
  // The ONLY allowed gcf.coverageStatus reference is the guarded assignment above.
  const refs = source.match(/gcf\.coverageStatus/g) ?? [];
  assert.equal(refs.length, 1, "exactly one gcf.coverageStatus reference (the gated assignment)");
});

test("UNKNOWN band copy remains the insufficient-data fallback", () => {
  assert.match(source, /UNKNOWN.{0,8}Insufficient data to compute DSCR/);
});
