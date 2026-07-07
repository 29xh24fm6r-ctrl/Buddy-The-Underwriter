/**
 * SPEC-PORTAL-1 §5.4/§5.5 — borrower path contract (static assertions, the repo's
 * client-contract idiom). Guards against re-drift: the upload client must target
 * the real prepare/commit routes, and PortalClient must use the token-scoped
 * routes rather than the RPCs that are absent from prod.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

const UPLOAD_CLIENT = "src/app/(borrower)/upload/[token]/client.tsx";
const PORTAL_CLIENT = "src/components/borrower/PortalClient.tsx";

describe("§5.4 upload client targets the real prepare/commit routes", () => {
  const src = read(UPLOAD_CLIENT);

  it("posts to /api/portal/upload/prepare and /commit", () => {
    assert.ok(src.includes("/api/portal/upload/prepare"));
    assert.ok(src.includes("/api/portal/upload/commit"));
  });

  it("no longer calls the nonexistent upload-init/upload-complete routes", () => {
    // Check for the actual call URLs (comments may still mention the names).
    assert.ok(!src.includes("${token}/upload-init"), "upload-init route never existed");
    assert.ok(!src.includes("${token}/upload-complete"), "upload-complete route never existed");
  });

  it("sends the commit contract fields the route requires", () => {
    // commit/route.ts requires token, path, filename, uploadSessionId.
    for (const key of ["token", "path", "filename", "uploadSessionId", "fileId"]) {
      assert.ok(src.includes(key), `commit body must include ${key}`);
    }
  });
});

describe("§5.5 PortalClient uses token-scoped routes, not absent RPCs", () => {
  const src = read(PORTAL_CLIENT);

  it("no longer calls the four absent portal RPCs", () => {
    // Check for the .rpc("name" call syntax (comments still name them as context).
    for (const rpc of [
      "portal_get_context",
      "portal_list_uploads",
      "portal_get_doc_fields",
      "portal_confirm_and_submit_document",
    ]) {
      assert.ok(!src.includes(`rpc("${rpc}"`), `${rpc} is absent from prod — must not be called`);
    }
  });

  it("contains no supabase.rpc( calls at all", () => {
    assert.ok(!/\.rpc\(/.test(src), "PortalClient must not call any RPC directly");
  });

  it("fetches the token-scoped route equivalents", () => {
    assert.ok(src.includes("/context"), "context route");
    assert.ok(src.includes("/docs`"), "docs list route");
    assert.ok(src.includes("/fields`"), "doc fields route");
    assert.ok(src.includes("/submit`"), "submit route");
  });
});
