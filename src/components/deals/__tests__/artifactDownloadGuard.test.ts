import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("classic spread downloads keep the blob alive through Chrome hand-off", () => {
  const shared = readFileSync("src/components/deals/ClassicSpreadDownloadLink.tsx", "utf8");
  const workspace = readFileSync("src/app/(app)/deals/[dealId]/classic-spreads/ClassicSpreadsClient.tsx", "utf8");

  assert.match(shared, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\)/);
  assert.match(workspace, /document\.body\.appendChild\(a\)/);
  assert.doesNotMatch(workspace, /4-page PDF/);
});

test("credit memo export accurately describes the browser print workflow", () => {
  const button = readFileSync("src/components/creditMemo/ExportCanonicalMemoPdfButton.tsx", "utf8");
  assert.match(button, /label = "Print \/ Save PDF"/);
});
