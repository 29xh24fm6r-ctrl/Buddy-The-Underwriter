import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("classic spread downloads use a native anchor and keep shared blobs alive", () => {
  const shared = readFileSync("src/components/deals/ClassicSpreadDownloadLink.tsx", "utf8");
  const workspace = readFileSync("src/app/(app)/deals/[dealId]/classic-spreads/ClassicSpreadsClient.tsx", "utf8");

  assert.match(shared, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\)/);
  assert.match(workspace, /href=\{pdfUrl \?\? undefined\}/);
  assert.match(workspace, /download=\{`FinancialSpread_/);
  assert.doesNotMatch(workspace, /document\.createElement\("a"\)/);
  assert.doesNotMatch(workspace, /4-page PDF/);
});

test("credit memo export accurately describes the browser print workflow", () => {
  const button = readFileSync("src/components/creditMemo/ExportCanonicalMemoPdfButton.tsx", "utf8");
  assert.match(button, /label = "Print \/ Save PDF"/);
});
