/**
 * SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1-HOTFIX — proves the self-serve
 * /start funnel now has a document-upload path authenticated the same way
 * every other /start route already is (buddy_borrower_session cookie via
 * getBorrowerSession()), instead of the Clerk-staff-only or
 * borrower_portal_links-gated routes it was previously (incorrectly)
 * calling. Structural tripwires + a behavioral test of the sign route
 * against a mocked session, same require.cache convention as
 * resolvePortalContext.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../../test/utils/mockServerOnly";

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

test("TRIPWIRE: IntakeFinancialsStep no longer calls the Clerk-staff-gated directDealDocumentUpload", () => {
  const src = readSrc("src/components/borrower/intake/IntakeFinancialsStep.tsx");
  assert.doesNotMatch(src, /directDealDocumentUpload/);
  assert.match(src, /borrowerIntakeDocumentUpload/);
});

test("TRIPWIRE: borrowerIntakeDocumentUpload targets the new session-authenticated routes, not the Clerk or borrower_portal_links ones", () => {
  const src = readSrc("src/lib/uploads/uploadFile.ts");
  const fnIdx = src.indexOf("export async function borrowerIntakeDocumentUpload(");
  assert.ok(fnIdx > -1);
  const fnBody = src.slice(fnIdx, fnIdx + 3000);
  assert.match(fnBody, /\/api\/borrower\/intake\/files\/sign/);
  assert.match(fnBody, /\/api\/borrower\/intake\/files\/record/);
  assert.doesNotMatch(fnBody, /\/api\/deals\/\$\{/, "must not call the Clerk-gated staff route");
  assert.doesNotMatch(fnBody, /\/api\/portal\/\$\{/, "must not call the borrower_portal_links-gated route");
});

test("TRIPWIRE: the new sign route authenticates via getBorrowerSession, not clerkAuth or resolvePortalContext", () => {
  const src = readSrc("src/app/api/borrower/intake/files/sign/route.ts");
  assert.match(src, /import \{ getBorrowerSession \} from "@\/lib\/brokerage\/sessionToken";/);
  assert.doesNotMatch(src, /^import.*clerkAuth/m);
  assert.doesNotMatch(src, /^import.*resolvePortalContext/m);
});

test("TRIPWIRE: the new record route authenticates via getBorrowerSession and is idempotent on (deal_id, storage_path)", () => {
  const src = readSrc("src/app/api/borrower/intake/files/record/route.ts");
  assert.match(src, /getBorrowerSession/);
  assert.match(src, /eq\("deal_id", session\.deal_id\)/);
  assert.match(src, /eq\("storage_path", object_path\)/);
});

// ─── Behavioral: sign route rejects when there's no session ──────────────

mockServerOnly();
const require = createRequire(import.meta.url);

let sessionState: { deal_id: string; bank_id: string } | null = null;

require.cache[require.resolve("@/lib/brokerage/sessionToken")] = {
  id: "session-stub",
  filename: "session-stub",
  loaded: true,
  exports: { getBorrowerSession: async () => sessionState },
} as any;

require.cache[require.resolve("@/lib/uploads/signDealUpload")] = {
  id: "sign-stub",
  filename: "sign-stub",
  loaded: true,
  exports: {
    signDealUpload: async () => ({
      ok: true,
      upload: {
        fileId: "file-1",
        objectKey: "deals/deal-1/file-1__test.pdf",
        uploadUrl: "https://storage.example.com/signed",
        headers: { "Content-Type": "application/pdf" },
        bucket: "deal-files",
      },
    }),
  },
} as any;

const { POST } = require("../route") as typeof import("../route");

test("sign route: 401s with no_borrower_session when there's no cookie-backed session", async () => {
  sessionState = null;
  const req = new Request("https://example.com/api/borrower/intake/files/sign", {
    method: "POST",
    body: JSON.stringify({ filename: "test.pdf", mime_type: "application/pdf", size_bytes: 1000 }),
  }) as any;
  const res = await POST(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error, "no_borrower_session");
});

test("sign route: succeeds and scopes to the session's own deal_id when authenticated", async () => {
  sessionState = { deal_id: "deal-1", bank_id: "bank-1" };
  const req = new Request("https://example.com/api/borrower/intake/files/sign", {
    method: "POST",
    body: JSON.stringify({ filename: "test.pdf", mime_type: "application/pdf", size_bytes: 1000 }),
  }) as any;
  const res = await POST(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.deal_id, "deal-1");
  assert.equal(json.upload.file_id, "file-1");
});
