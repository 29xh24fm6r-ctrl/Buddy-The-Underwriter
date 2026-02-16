import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("TRIPWIRE: processArtifact must not use slots for routing or spreads", () => {
  const p = path.join(process.cwd(), "src/lib/artifacts/processArtifact.ts");
  const src = fs.readFileSync(p, "utf8");

  const forbidden = [
    "lookupSlotDocType",
    "slotDocType",
    "effectiveDocType = slot",
    ".from(\"deal_document_slots\")",
    ".from('deal_document_slots')",
  ];

  for (const needle of forbidden) {
    assert.equal(
      src.includes(needle),
      false,
      `processArtifact.ts must not contain "${needle}" (slots are UX-only)`,
    );
  }
});
