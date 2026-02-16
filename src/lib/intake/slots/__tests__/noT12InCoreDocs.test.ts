import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CORE_DOCS_FILES = [
  "src/lib/intake/slots/policies/conventional.ts",
  "src/lib/intake/slots/policies/sba7a.ts",
  "src/components/deals/cockpit/panels/CoreDocumentsPanel.tsx",
];

const FORBIDDEN = ["PROPERTY_T12", "TRAILING_12"];
// Note: "T12" alone is NOT forbidden because validateSlotAttachment.ts
// uses it in equivalence mappings (INCOME_STATEMENT: [..., "T12"])

test("TRIPWIRE: Core Docs policies/UI must not reference T12 slot requirements", () => {
  for (const file of CORE_DOCS_FILES) {
    const p = path.join(process.cwd(), file);
    const src = fs.readFileSync(p, "utf8");
    for (const needle of FORBIDDEN) {
      assert.equal(
        src.includes(needle),
        false,
        `${file} must not contain "${needle}" (Core Docs are borrower-first)`,
      );
    }
  }
});
