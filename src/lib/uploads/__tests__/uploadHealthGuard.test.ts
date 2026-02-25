/**
 * CI Source Guards — Upload Health Endpoint + Client Guard Invariants
 *
 * These are SOURCE GUARDS (string/regex) — not integration tests.
 * They read source files as strings and assert structural invariants
 * that must hold across formatting and refactoring changes.
 *
 * Enforced invariants:
 *  1. upload-health filters BOTH deal_documents + deal_upload_session_files by bank_id
 *  2. upload-health verifies deal ownership (deals queried with id + bank_id) BEFORE Promise.all
 *  3. upload-health emits writeEvent kind "upload.docs_not_recorded" when gap_detected
 *  4. NewDealClient checks health.gap_detected and throws error containing "failed to record"
 *  5. NewDealClient error includes dealId + sessionId
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __esmDirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__esmDirname, "../../../..");

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

/**
 * Extract the Supabase fluent query chain starting from `.from("table")`.
 * Captures up to ~1200 chars, ending at a semicolon or closing bracket.
 * Accepts single or double quotes around the table name.
 */
function findQueryChainForTable(src: string, table: string): string | null {
  const pattern = new RegExp(
    `\\.from\\(\\s*["']${table}["']\\s*\\)([\\s\\S]{0,1200}?)(?:;|\\n\\s*\\)|\\n\\s*\\])`,
  );
  const match = src.match(pattern);
  return match ? match[0] : null;
}

const healthSrc = readSource(
  "src/app/api/deals/[dealId]/files/upload-health/route.ts",
);
const clientSrc = readSource(
  "src/app/(app)/deals/new/NewDealClient.tsx",
);

// Regex: .eq("bank_id" or .eq('bank_id' — tolerates whitespace and quote style
const BANK_ID_FILTER = /\.eq\(\s*["']bank_id["']/;

describe("Upload Health Endpoint Guards", () => {
  test("[guard-1] deal_documents query must filter by bank_id", () => {
    const chain = findQueryChainForTable(healthSrc, "deal_documents");
    assert.ok(chain, "Route must query deal_documents");
    assert.ok(
      BANK_ID_FILTER.test(chain),
      'deal_documents query chain must include .eq("bank_id", ...) filter',
    );
  });

  test("[guard-2] deal_upload_session_files query must filter by bank_id", () => {
    const chain = findQueryChainForTable(healthSrc, "deal_upload_session_files");
    assert.ok(chain, "Route must query deal_upload_session_files");
    assert.ok(
      BANK_ID_FILTER.test(chain),
      'deal_upload_session_files query chain must include .eq("bank_id", ...) filter',
    );
  });

  test("[guard-3] route must verify deal ownership before parallel queries", () => {
    // Ownership: deals table queried with both .eq("id") and .eq("bank_id")
    const ownershipPattern =
      /\.from\(\s*["']deals["']\s*\)[\s\S]{0,800}?\.eq\(\s*["']id["'][\s\S]{0,200}?\.eq\(\s*["']bank_id["']/;
    const ownershipMatch = ownershipPattern.exec(healthSrc);
    assert.ok(ownershipMatch, "Route must query deals with both id and bank_id filters");

    const parallelIdx = healthSrc.search(/Promise\.all/);
    assert.ok(parallelIdx >= 0, "Route must have Promise.all for parallel queries");
    assert.ok(
      ownershipMatch.index < parallelIdx,
      "Deal ownership check must appear BEFORE Promise.all parallel count queries",
    );
  });

  test("[guard-4] route must emit writeEvent with kind upload.docs_not_recorded on gap", () => {
    assert.ok(
      /kind:\s*["']upload\.docs_not_recorded["']/.test(healthSrc),
      'Route must emit writeEvent with kind "upload.docs_not_recorded"',
    );
    assert.ok(
      /\bgap_detected\b/.test(healthSrc),
      "Route must reference gap_detected",
    );
  });
});

describe("NewDealClient Health Check Guards", () => {
  test("[guard-5] client must throw on gap_detected", () => {
    assert.ok(
      /\bhealth\.gap_detected\b/.test(clientSrc),
      "Client must check health.gap_detected",
    );
    assert.ok(
      /throw\s+new\s+Error\([\s\S]*?failed to record/.test(clientSrc),
      'Client must throw new Error containing "failed to record"',
    );
  });

  test("[guard-6] error message must include dealId and sessionId", () => {
    // Extract the throw block around "failed to record"
    const throwPattern = /throw\s+new\s+Error\(([\s\S]*?failed to record[\s\S]*?)\);/;
    const throwMatch = clientSrc.match(throwPattern);
    assert.ok(throwMatch, 'Must have throw new Error(...failed to record...) in source');

    const throwBlock = throwMatch[1];
    assert.ok(
      /\bdealId\b/.test(throwBlock),
      "Error message must include dealId for debugging",
    );
    assert.ok(
      /\bsessionId\b/.test(throwBlock),
      "Error message must include sessionId for debugging",
    );
  });
});
