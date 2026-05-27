/**
 * SPEC-BUDDY-HARD-STOP-AUDIT-AND-RECOVERY-1 #7:
 * Source-level guard ensuring repairBlankDealName is wired into the
 * intake-completion path and uses the documented source order.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const READ = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("[name-repair-1] repairBlankDealName module exists and exports the function", () => {
  const src = READ("src/lib/naming/repairBlankDealName.ts");
  assert.match(
    src,
    /export\s+async\s+function\s+repairBlankDealName/,
    "repairBlankDealName must be exported",
  );
});

test("[name-repair-2] processConfirmedIntake invokes repairBlankDealName after runNamingDerivation", () => {
  const src = READ("src/lib/intake/processing/processConfirmedIntake.ts");
  assert.match(
    src,
    /repairBlankDealName/,
    "processConfirmedIntake must import & call repairBlankDealName",
  );
  // The repair must come AFTER runNamingDerivation in the file.
  const idxDerive = src.indexOf("runNamingDerivation");
  const idxRepair = src.indexOf("repairBlankDealName");
  assert.ok(idxDerive >= 0 && idxRepair >= 0, "both calls must be present");
  assert.ok(
    idxRepair > idxDerive,
    "repairBlankDealName must be invoked AFTER runNamingDerivation so derivation gets first crack at producing a name",
  );
});

test("[name-repair-3] repair helper uses borrower_name → primary owner → synthetic fallback order", () => {
  const src = READ("src/lib/naming/repairBlankDealName.ts");
  // The three sources must appear in the file in the documented order.
  const idxBorrower = src.indexOf("borrower_name");
  const idxOwner = src.indexOf("primary_owner");
  assert.ok(idxBorrower >= 0, "must reference borrower_name source");
  assert.ok(idxOwner >= 0, "must reference primary_owner source");
  assert.match(src, /"fallback"/, "must reference synthetic fallback source variant");
  assert.ok(
    idxBorrower < idxOwner,
    "borrower_name must be tried before primary owner",
  );
});

test("[name-repair-4] repair never blocks phase transition (errors caught, ledger event on failure)", () => {
  const src = READ("src/lib/naming/repairBlankDealName.ts");
  assert.match(
    src,
    /intake\.deal_name_repair_failed/,
    "helper must emit intake.deal_name_repair_failed on update error so failures are observable",
  );
  assert.match(
    src,
    /intake\.deal_name_repaired/,
    "helper must emit intake.deal_name_repaired on success so the audit trail captures the new name + source",
  );

  const intakeSrc = READ("src/lib/intake/processing/processConfirmedIntake.ts");
  // The call site must be in a try/catch that pushes to errors[] but does
  // not throw — phase transition must remain unblocked.
  assert.match(
    intakeSrc,
    /try\s*\{\s*[\s\S]{0,200}repairBlankDealName/,
    "repairBlankDealName must be invoked inside a try block so its failures cannot block PROCESSING_COMPLETE",
  );
});

test("[name-repair-5] placeholder names (NEEDS NAME / Untitled) are treated as repairable", () => {
  const src = READ("src/lib/naming/repairBlankDealName.ts");
  assert.match(
    src,
    /NEEDS NAME/,
    "must recognise the legacy NEEDS NAME placeholder",
  );
  assert.match(
    src,
    /UNTITLED_PATTERN/,
    "must recognise 'Untitled deal ...' placeholders via UNTITLED_PATTERN",
  );
});
