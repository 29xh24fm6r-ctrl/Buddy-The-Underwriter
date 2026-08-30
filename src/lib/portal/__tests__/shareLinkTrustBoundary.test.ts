import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");

test("share bearer tokens use cryptographic randomness and bounded authoritative reads", () => {
  const links = read("lib/portal/shareLinks.ts");
  assert.ok(links.includes('randomBytes(36).toString("base64url")'));
  assert.ok(!links.includes("Math.random"));
  assert.ok(links.includes("TOKEN_RE"));
  assert.ok(links.includes("MAX_SCOPE_ITEMS"));
  assert.ok(links.includes("new Set(ids).size !== ids.length"));
  assert.ok(links.includes("SHARE_COLUMNS"));
  assert.ok(!links.includes('.select("*")'));
  assert.ok(links.includes('throw new Error("share_create_unproven")'));
  assert.ok(links.includes('reason: "invalid_expiry"'));
});

test("share auth bounds the bearer token and distinguishes lookup outages", () => {
  const auth = read("lib/portal/shareAuth.ts");
  assert.ok(auth.includes("isValidShareTokenFormat"));
  assert.ok(auth.includes("ShareTokenError(503"));
  assert.ok(!auth.includes("Invalid share link:"));
  assert.ok(!auth.includes("return {\n    token,"));
});

test("share view and upload require complete evidence before green outcomes", () => {
  const route = read("app/api/portal/share/[action]/route.ts");
  assert.ok(route.includes('"Cache-Control": "no-store, private, max-age=0"'));
  assert.ok(route.includes("returned.size !== checklistItemIds.length"));
  assert.ok(route.includes("bytes.length !== file.size"));
  assert.ok(route.includes("ingested?.documentId"));
  assert.ok(route.includes("logLedgerEventRequired"));
  assert.ok(route.includes("upload_reconciliation_required"));
  assert.ok(route.includes("retryable: false"));
  assert.ok(route.includes("return json({ ok: true, document_id: documentId }, 201)"));
  assert.ok(!route.includes("error: e?.message"));
  assert.ok(!route.includes("storagePath,\n      error:"));
  assert.ok(!route.includes(".catch(() => {})"));
});
