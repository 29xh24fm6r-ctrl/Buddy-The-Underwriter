// SPEC-LOAN-REQUEST-CTA-FIX-1
//
// Regression guard: `?tab=setup` may not appear in any swapped location.
// Whitelisted: intake_created, checklist_not_seeded, builderPartiesIncomplete,
// and builderCollateralMissing branches still point there (tracked under
// separate follow-up specs). Whitelist is file-bounded; broaden only if those
// blockers get their own pages.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

const WHITELIST_FILES = new Set<string>([
  // intake_created + checklist_not_seeded TODOs — separate follow-up
  "src/buddy/lifecycle/nextAction.ts",
  // builderPartiesIncomplete + builderCollateralMissing TODOs — separate follow-up
  "src/lib/dealCommandCenter/getDealNextStep.ts",
]);

test("no ?tab=setup references outside whitelisted TODO sites", () => {
  let out = "";
  try {
    out = execSync(
      "grep -rn '?tab=setup' src --include='*.ts' --include='*.tsx' || true",
      { encoding: "utf8" },
    );
  } catch {
    out = "";
  }

  const hits = out.split("\n").filter((l) => l.trim() && !l.includes("__tests__"));
  const offenders: string[] = [];

  for (const line of hits) {
    const [filePath] = line.split(":");
    if (!WHITELIST_FILES.has(filePath)) {
      offenders.push(line);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Unexpected ?tab=setup references (loan-request CTA must use /deals/{id}/loan-request):\n${offenders.join("\n")}`,
  );
});

test("whitelisted ?tab=setup sites have explicit TODO comments", () => {
  for (const file of WHITELIST_FILES) {
    const src = execSync(`cat ${file}`, { encoding: "utf8" });
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("?tab=setup")) continue;
      const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      assert.match(
        context,
        /TODO.*SPEC-LOAN-REQUEST-CTA-FIX-1/,
        `${file}:${i + 1} — ?tab=setup must have a TODO(SPEC-LOAN-REQUEST-CTA-FIX-1) comment within 3 lines above`,
      );
    }
  }
});
