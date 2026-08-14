import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("classic spread downloads use a native anchor and keep shared blobs alive", () => {
  const shared = readFileSync("src/components/deals/ClassicSpreadDownloadLink.tsx", "utf8");
  const workspace = readFileSync("src/app/(app)/deals/[dealId]/classic-spreads/ClassicSpreadsClient.tsx", "utf8");

  assert.match(shared, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\)/);
  assert.match(workspace, /classic-spread\/cached\?download=1/);
  assert.match(workspace, /download=\{`FinancialSpread_/);
  assert.doesNotMatch(workspace, /document\.createElement\("a"\)/);
  assert.doesNotMatch(workspace, /4-page PDF/);
});

test("cached spread endpoint returns an attachment for explicit downloads", () => {
  const route = readFileSync(
    "src/app/api/deals/[dealId]/classic-spread/cached/route.ts",
    "utf8",
  );

  assert.match(route, /searchParams\.get\("download"\) === "1"/);
  assert.match(route, /\? "attachment"/);
  assert.match(route, /`\$\{disposition\}; filename=/);
});

test("credit memo export accurately describes the browser print workflow", () => {
  const button = readFileSync("src/components/creditMemo/ExportCanonicalMemoPdfButton.tsx", "utf8");
  assert.match(button, /label = "Print \/ Save PDF"/);
});
