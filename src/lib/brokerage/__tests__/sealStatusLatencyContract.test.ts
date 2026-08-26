import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("seal-status keeps database reads bounded and concurrent", () => {
  const identityGate = source("../identityVerificationGate.ts");
  const sealingGate = source("../sealingGate.ts");
  const packageDelivery = source("../packageDelivery.ts");
  const sealStatus = source("../../../app/api/brokerage/deals/[dealId]/seal-status/route.ts");

  assert.match(
    identityGate,
    /\.in\("ownership_entity_id", ownerIds\)/,
    "owner verification must stay set-based instead of returning to one query per owner",
  );
  assert.doesNotMatch(
    identityGate,
    /for\s*\([^)]*owner[^)]*\)[\s\S]{0,200}await/,
    "owner verification must not reintroduce an awaited N+1 loop",
  );
  assert.match(
    sealingGate,
    /await Promise\.all\(\[[\s\S]*ownersNeedingIal2/,
    "independent seal gates must execute concurrently",
  );
  assert.match(
    packageDelivery,
    /const \[b, \{ data: f \}, \{ data: memoSnapshot \}, assembledRun\] = await Promise\.all/,
    "picked-package resources must not serialize the polling response",
  );
  assert.match(
    sealStatus,
    /gate,[\s\S]*score,[\s\S]*= await Promise\.all\(\[[\s\S]*canSeal\(dealId, sb\)[\s\S]*loadScoreForResponse/,
    "sealability, listing state, and score must share the same polling wave",
  );
});
