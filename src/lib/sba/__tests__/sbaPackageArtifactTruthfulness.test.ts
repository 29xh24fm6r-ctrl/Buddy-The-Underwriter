import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isPdfSignature,
  parseSbaPackagePdfPath,
} from "../sbaPackageArtifact";

test("accepts only deal-scoped SBA package PDF paths", () => {
  const dealId = "deal-123";
  assert.equal(
    parseSbaPackagePdfPath(dealId, "sba-packages/deal-123/1787940000.pdf"),
    "sba-packages/deal-123/1787940000.pdf",
  );
  assert.equal(
    parseSbaPackagePdfPath(
      dealId,
      "sba-packages/deal-123/1787940000_preview.pdf",
    ),
    "sba-packages/deal-123/1787940000_preview.pdf",
  );

  for (const value of [
    null,
    "",
    "/sba-packages/deal-123/file.pdf",
    "sba-packages/other-deal/file.pdf",
    "sba-packages/deal-123/../secret.pdf",
    "sba-packages/deal-123/nested/file.pdf",
    "sba-packages/deal-123/file.txt",
    "sba-packages\\deal-123\\file.pdf",
  ]) {
    assert.equal(parseSbaPackagePdfPath(dealId, value), null);
  }
});

test("recognizes the canonical PDF file signature", () => {
  assert.equal(isPdfSignature(new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(isPdfSignature(new TextEncoder().encode("<html>")), false);
  assert.equal(isPdfSignature(new Uint8Array()), false);
});

test("SBA package generation proves PDF and canonical-row persistence", () => {
  const source = readFileSync("src/lib/sba/sbaPackageOrchestrator.ts", "utf8");

  assert.match(source, /upsert: false/);
  assert.match(source, /SBA package PDF upload failed\./);
  assert.match(
    source,
    /packageInsertError \|\| !pkg\?\.id \|\| pkg\.pdf_url !== pdfUrl/,
  );
  assert.match(source, /SBA package persistence failed\./);
  assert.match(source, /\.remove\(\[pdfPath\]\)/);
  assert.doesNotMatch(source, /Non-fatal: proceed without PDF/);
  assert.doesNotMatch(source, /packageId: pkg\?\.id \?\? ""/);
});

test("SBA PDF retrieval is authenticated, scoped, validated, and private", () => {
  const route = readFileSync(
    "src/app/api/deals/[dealId]/sba/package-pdf/route.ts",
    "utf8",
  );
  const viewer = readFileSync("src/components/sba/SBAPackageViewer.tsx", "utf8");
  const page = readFileSync(
    "src/app/(app)/deals/[dealId]/sba-package/page.tsx",
    "utf8",
  );
  const api = readFileSync("src/app/api/deals/[dealId]/sba/route.ts", "utf8");

  assert.match(route, /ensureDealBankAccess\(dealId\)/);
  assert.match(route, /\.eq\("deal_id", dealId\)/);
  assert.match(route, /\.eq\("id", packageId\)/);
  assert.match(route, /parseSbaPackagePdfPath\(dealId, row\.pdf_url\)/);
  assert.match(route, /\.from\("deal-documents"\)/);
  assert.match(route, /\.download\(pdfPath\)/);
  assert.match(route, /isPdfSignature\(bytes\)/);
  assert.match(route, /"cache-control": "private, no-store"/);
  assert.match(route, /"content-disposition": `attachment;/);

  assert.match(viewer, /\/sba\/package-pdf\?packageId=/);
  assert.doesNotMatch(viewer, /\/api\/storage\/\$\{pkg\.pdfUrl\}/);
  assert.match(page, /id: packageRow\.id/);
  assert.match(page, /assumptionsResult\.error \|\| packageResult\.error/);
  assert.match(api, /if \(rowError\)/);
  assert.match(api, /package_lookup_failed/);
});
