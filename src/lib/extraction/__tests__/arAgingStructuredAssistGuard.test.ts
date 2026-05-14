import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { synthesizeArAgingTableFromStructuredAssist } from "@/lib/extract/router/synthesizeArAgingTable";

const ROOT = process.cwd();

test("[ar-aging-1] AR_AGING is mapped to GEMINI_STRUCTURED", () => {
  const src = readFileSync(
    resolve(ROOT, "src/lib/documents/docTypeRouting.ts"),
    "utf8",
  );
  // Match the AR_AGING line in ROUTING_CLASS_MAP, allowing trailing comment.
  assert.match(
    src,
    /AR_AGING:\s*"GEMINI_STRUCTURED"/,
    "AR_AGING must be in GEMINI_STRUCTURED routing class",
  );
  // Negative check — make sure the old GEMINI_PACKET mapping is gone.
  assert.doesNotMatch(
    src,
    /AR_AGING:\s*"GEMINI_PACKET"/,
    "stale AR_AGING: GEMINI_PACKET mapping must be removed",
  );
});

test("[ar-aging-2] buildStructuredAssistPrompt handles AR_AGING", () => {
  const src = readFileSync(
    resolve(ROOT, "src/lib/extraction/geminiFlashPrompts.ts"),
    "utf8",
  );
  assert.match(
    src,
    /case\s+"AR_AGING":/,
    "buildStructuredAssistPrompt switch must have an AR_AGING case",
  );
  assert.match(
    src,
    /function\s+buildArAgingPrompt\s*\(/,
    "buildArAgingPrompt function must exist",
  );
});

test("[ar-aging-3] extractByDocType references synthesis helper", () => {
  const src = readFileSync(
    resolve(ROOT, "src/lib/extract/router/extractByDocType.ts"),
    "utf8",
  );
  assert.match(
    src,
    /synthesizeArAgingTableFromStructuredAssist/,
    "extractByDocType must import the synthesis helper",
  );
});

test("[ar-aging-4] extractByDocType uses canonicalType for fields_json.docType", () => {
  const src = readFileSync(
    resolve(ROOT, "src/lib/extract/router/extractByDocType.ts"),
    "utf8",
  );
  assert.match(
    src,
    /docType:\s*canonicalType/,
    "extractWithGeminiOcr must use canonicalType, not doc.type, for fields_json.docType",
  );
  // Narrow negative check — only the inner `fields: { ... docType: doc.type }`
  // pattern (the persisted extraction record) must be gone. Other observability
  // sites where `docType: doc.type` appears alongside a separate `canonicalType`
  // field are intentionally preserved (raw upload type vs canonical type).
  assert.doesNotMatch(
    src,
    /fields:\s*\{[^}]*docType:\s*doc\.type/s,
    "old 'docType: doc.type' inside the persisted fields object must be removed",
  );
});

test("[ar-aging-5] synthesizeArAgingTableFromStructuredAssist handles minimal valid input", () => {
  const input = {
    entities: [],
    formFields: [
      { name: "ar_aging_cell:0:customer", value: "Humana", confidence: 0.99 },
      { name: "ar_aging_cell:0:current", value: "715515.60", confidence: 0.99 },
      { name: "ar_aging_cell:0:d1_30", value: "17278.80", confidence: 0.99 },
      { name: "ar_aging_cell:0:d31_60", value: "125763.00", confidence: 0.99 },
      { name: "ar_aging_cell:0:total", value: "967477.71", confidence: 0.99 },
      { name: "aging_type", value: "AR", confidence: 1 },
    ],
  };
  const out = synthesizeArAgingTableFromStructuredAssist(input);
  assert.ok(out, "should produce a table");
  assert.equal(out!.rows[0][0], "Customer");
  assert.equal(out!.rows[1][0], "Humana");
  assert.equal(out!.rows[1][1], "715515.60");
  // 4 numeric buckets + customer = 5 columns total in this minimal input
  assert.equal(out!.rows[1].length, 5);
});

test("[ar-aging-6] synthesize refuses AP aging", () => {
  const input = {
    entities: [],
    formFields: [
      { name: "ar_aging_cell:0:customer", value: "Vendor A", confidence: 0.99 },
      { name: "ar_aging_cell:0:current", value: "1000", confidence: 0.99 },
      { name: "ar_aging_cell:0:d1_30", value: "500", confidence: 0.99 },
      { name: "ar_aging_cell:0:d31_60", value: "200", confidence: 0.99 },
      { name: "aging_type", value: "AP", confidence: 1 },
    ],
  };
  const out = synthesizeArAgingTableFromStructuredAssist(input);
  assert.equal(out, null, "AP aging must be refused");
});

test("[ar-aging-7] synthesize handles parenthesized negative values", () => {
  const input = {
    entities: [],
    formFields: [
      { name: "ar_aging_cell:0:customer", value: "Affinity Cellular", confidence: 0.99 },
      { name: "ar_aging_cell:0:current", value: "9032.18", confidence: 0.99 },
      { name: "ar_aging_cell:0:d31_60", value: "0", confidence: 0.99 },
      { name: "ar_aging_cell:0:d91_plus", value: "(8066.89)", confidence: 0.99 },
      { name: "ar_aging_cell:0:total", value: "965.29", confidence: 0.99 },
    ],
  };
  const out = synthesizeArAgingTableFromStructuredAssist(input);
  assert.ok(out);
  // Find the 91+ value — index 3 (after Customer, Current, 31-60)
  const customerRow = out!.rows[1];
  assert.ok(
    customerRow.some((c) => c === "-8066.89"),
    `expected -8066.89 in row, got: ${customerRow.join(",")}`,
  );
});

test("[ar-aging-8] synthesize returns null on empty / malformed input", () => {
  assert.equal(synthesizeArAgingTableFromStructuredAssist(null), null);
  assert.equal(synthesizeArAgingTableFromStructuredAssist(undefined), null);
  assert.equal(synthesizeArAgingTableFromStructuredAssist({}), null);
  assert.equal(synthesizeArAgingTableFromStructuredAssist({ formFields: [] }), null);
  // Only customer column, no numeric buckets
  assert.equal(
    synthesizeArAgingTableFromStructuredAssist({
      formFields: [
        { name: "ar_aging_cell:0:customer", value: "Foo", confidence: 1 },
      ],
    }),
    null,
  );
});
