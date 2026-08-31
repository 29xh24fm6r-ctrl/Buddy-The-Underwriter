import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sanitizeClientTelemetry } from "@/lib/observability/clientTelemetry";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("client telemetry keeps only bounded operational evidence", () => {
  assert.deepEqual(
    sanitizeClientTelemetry({
      request_id: "upl_123",
      stage: "sign_response",
      message: "borrower@example.com",
      meta: {
        attempt: 2,
        status: 503,
        ok: false,
        response_ok: false,
        code: "HTTP_503",
        dealId: "11111111-1111-1111-1111-111111111111",
        filename: "Jane-Doe-tax-return.pdf",
        file_id: "22222222-2222-2222-2222-222222222222",
        object_path: "private/bank/deal/document.pdf",
        error: "raw provider failure",
        details: { secret: "nested" },
      },
    }),
    {
      request_id: "upl_123",
      stage: "sign_response",
      meta: {
        attempt: 2,
        status: 503,
        ok: false,
        response_ok: false,
        code: "HTTP_503",
      },
    },
  );
});

test("client telemetry rejects malformed identities and unbounded payload tokens", () => {
  assert.equal(sanitizeClientTelemetry(null), null);
  assert.equal(sanitizeClientTelemetry({ request_id: "id", stage: "contains spaces" }), null);
  assert.equal(sanitizeClientTelemetry({ request_id: "x".repeat(129), stage: "upload_start" }), null);
  assert.equal(sanitizeClientTelemetry({ request_id: "id", stage: "x".repeat(65) }), null);
});

test("client telemetry can use a validated request header fallback", () => {
  assert.deepEqual(
    sanitizeClientTelemetry({ stage: "storage_put_ok", meta: { ok: true } }, "header_123"),
    { request_id: "header_123", stage: "storage_put_ok", meta: { ok: true } },
  );
  assert.equal(
    sanitizeClientTelemetry({ stage: "storage_put_ok" }, "header contains spaces"),
    null,
  );
});

test("telemetry route authenticates, bounds input, redacts, and never logs request headers", () => {
  const route = read("src/app/api/debug/client-telemetry/route.ts");
  const upload = read("src/lib/uploads/uploadFile.ts");

  assert.match(route, /safeClerkAuth\(3_000\)/);
  assert.match(route, /authentication_unavailable/);
  assert.match(route, /unauthorized/);
  assert.match(route, /MAX_BODY_BYTES\s*=\s*8_192/);
  assert.match(route, /sanitizeClientTelemetry/);
  assert.match(route, /console\.info\("\[client-telemetry\]", payload\)/);
  assert.doesNotMatch(route, /referer|userAgent|headers\.get\("host"\)/);

  assert.match(upload, /sanitizeClientTelemetry\(payload\)/);
  assert.match(upload, /JSON\.stringify\(sanitized\)/);
  assert.doesNotMatch(upload, /JSON\.stringify\(payload\)/);
});
