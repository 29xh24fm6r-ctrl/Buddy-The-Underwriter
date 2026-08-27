import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildProductMetadata } from "@/lib/brokerage/productMetadata";

function absoluteTitle(metadata: ReturnType<typeof buildProductMetadata>): string {
  const title = metadata.title as { absolute?: string } | null | undefined;
  return title?.absolute ?? "";
}

test("Buddy SBA metadata never inherits the underwriting product identity", () => {
  const metadata = buildProductMetadata("brokerage");

  assert.equal(String(metadata.metadataBase), "https://www.buddysba.com/");
  assert.equal(metadata.alternates?.canonical, "https://www.buddysba.com/");
  assert.match(absoluteTitle(metadata), /Buddy SBA/);
  assert.match(String(metadata.description), /SBA loan package/);
  assert.equal(metadata.openGraph?.url, "https://www.buddysba.com/");
  assert.equal(metadata.openGraph?.siteName, "Buddy SBA");
  assert.doesNotMatch(String(metadata.description), /Loan Operations System/);
});

test("underwriter metadata remains bound to its own canonical domain", () => {
  const metadata = buildProductMetadata("underwriter");

  assert.equal(String(metadata.metadataBase), "https://www.buddytheunderwriter.com/");
  assert.equal(metadata.alternates?.canonical, "https://www.buddytheunderwriter.com/");
  assert.match(absoluteTitle(metadata), /Buddy The Underwriter/);
  assert.equal(metadata.openGraph?.url, "https://www.buddytheunderwriter.com/");
});

test("both public entry pages opt into complete product metadata", () => {
  const brokeragePage = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");
  const brokerageRoute = readFileSync(
    resolve(process.cwd(), "src/app/brokerage/page.tsx"),
    "utf8",
  );
  const underwriterPage = readFileSync(
    resolve(process.cwd(), "src/app/underwriter/page.tsx"),
    "utf8",
  );

  assert.match(brokeragePage, /buildProductMetadata\("brokerage"\)/);
  assert.match(underwriterPage, /buildProductMetadata\("underwriter"\)/);
});