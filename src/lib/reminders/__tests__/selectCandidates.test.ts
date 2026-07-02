/**
 * SPEC-REMINDERS-PHONE-SOURCE-1
 *
 * (1) pickLatestPhoneByDeal behavior — newest-first rows collapse to the first
 *     phone per deal, null deal_ids are skipped, empty input → empty map.
 * (2) Source-grep invariant on selectCandidates.ts — the file must source
 *     borrower phone from borrower_phone_links and the SMS deal name from
 *     display_name, and must never reference the columns that either do not
 *     exist (deals.borrower_phone) or leak fixture strings into borrower SMS
 *     (deals.name / borrower_name).
 *
 * Note: pickLatestPhoneByDeal is imported from its own pure module because
 * selectCandidates.ts is `import "server-only"` and cannot be imported under
 * the `node --test --import tsx` unit runner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pickLatestPhoneByDeal } from "../pickLatestPhoneByDeal";

test("pickLatestPhoneByDeal: newest-first rows pick the first occurrence per deal", () => {
  const rows = [
    { deal_id: "d1", phone_e164: "+15550001111", created_at: "2026-07-01T00:00:00Z" },
    { deal_id: "d1", phone_e164: "+15550002222", created_at: "2026-06-01T00:00:00Z" },
    { deal_id: "d2", phone_e164: "+15550003333", created_at: "2026-06-15T00:00:00Z" },
  ];
  const out = pickLatestPhoneByDeal(rows);
  assert.equal(out.get("d1"), "+15550001111"); // newest for d1 wins
  assert.equal(out.get("d2"), "+15550003333");
  assert.equal(out.size, 2);
});

test("pickLatestPhoneByDeal: skips rows with a null deal_id", () => {
  const rows = [
    { deal_id: null, phone_e164: "+15559990000", created_at: "2026-07-01T00:00:00Z" },
    { deal_id: "d3", phone_e164: "+15550004444", created_at: "2026-07-01T00:00:00Z" },
  ];
  const out = pickLatestPhoneByDeal(rows);
  assert.equal(out.has("d3"), true);
  assert.equal(out.get("d3"), "+15550004444");
  assert.equal(out.size, 1);
});

test("pickLatestPhoneByDeal: empty input → empty map", () => {
  const out = pickLatestPhoneByDeal([]);
  assert.equal(out.size, 0);
});

test("selectCandidates.ts sources phone/name from the correct columns (leak + schema guard)", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/reminders/selectCandidates.ts"),
    "utf8"
  );

  // Must NOT reference the nonexistent deals column or the fixture-leak columns.
  // Strip the legitimate `borrower_phone_links` table name first so the bare
  // `borrower_phone` column check isn't tripped by the substring match.
  const withoutPhoneLinks = src.replaceAll("borrower_phone_links", "");
  assert.equal(withoutPhoneLinks.includes("borrower_phone"), false, "must not reference the nonexistent borrower_phone column");
  assert.equal(src.includes("deals.name"), false, "must not reference deals.name (fixture leak)");
  assert.equal(src.includes("borrower_name"), false, "must not reference borrower_name (fixture leak)");

  // Must source phone from borrower_phone_links and name from display_name.
  assert.equal(src.includes("borrower_phone_links"), true, "must resolve phone from borrower_phone_links");
  assert.equal(src.includes("display_name"), true, "must use display_name for borrower-facing deal name");
});
