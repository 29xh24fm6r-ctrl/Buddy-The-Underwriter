import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  sanitizeQaClickCapture,
  sanitizeQaPath,
} from "@/lib/qaClickTelemetry";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

test("QA click capture retains only bounded operational evidence", () => {
  assert.deepEqual(
    sanitizeQaClickCapture({
      sessionId: "qa-session-1234",
      payload: {
        ts: "2026-08-30T10:30:00.000Z",
        path:
          "/banker/deals/11111111-1111-4111-8111-111111111111?email=borrower@example.com#secret",
        element: {
          tag: "BUTTON",
          testId: "save-button",
          qaId: "memo.save",
          id: "borrower-11111111-1111-4111-8111-111111111111",
          classes: "customer-jane-doe",
          name: "ssn",
          type: "text",
          text: "Borrower Jane Doe",
          ariaLabel: "Borrower email",
          href: "https://example.test/deal?token=secret",
        },
      },
    }),
    {
      sessionId: "qa-session-1234",
      payload: {
        path: "/banker/deals/:id",
        element: {
          tag: "button",
          testId: "save-button",
          qaId: "memo.save",
        },
      },
    },
  );
});

test("QA paths strip queries and redact encoded identities", () => {
  assert.equal(
    sanitizeQaPath("/apply/jane%40example.com?token=one-time-secret"),
    "/apply/:id",
  );
  assert.equal(sanitizeQaPath("/banker/portfolio/risk"), "/banker/portfolio/risk");
  assert.equal(sanitizeQaPath("https://example.test/not-a-path"), null);
});

test("QA click capture rejects malformed identities and required fields", () => {
  assert.equal(
    sanitizeQaClickCapture({
      sessionId: "contains spaces",
      payload: { path: "/banker", element: { tag: "button" } },
    }),
    null,
  );
  assert.equal(
    sanitizeQaClickCapture({
      sessionId: "qa-session-1234",
      payload: { path: "banker", element: { tag: "button" } },
    }),
    null,
  );
  assert.equal(
    sanitizeQaClickCapture({
      sessionId: "qa-session-1234",
      payload: { path: "/banker", element: { tag: "" } },
    }),
    null,
  );
});

test("QA client and server share the strict privacy and authority boundary", () => {
  const route = read("src/app/api/qa/clicks/route.ts");
  const provider = read("src/components/qa/QaModeProvider.tsx");

  assert.match(route, /process\.env\.QA_MODE === "1"/);
  assert.doesNotMatch(route, /x-qa-mode|NEXT_PUBLIC_QA_MODE|z\.any/);
  assert.match(route, /safeClerkAuth\(3_000\)/);
  assert.match(route, /MAX_BODY_BYTES = 8_192/);
  assert.match(route, /sanitizeQaClickCapture/);
  assert.match(route, /\.select\("id"\)[\s\S]*\.single\(\)/);
  assert.doesNotMatch(route, /error\.message|e\?\.message/);

  assert.match(provider, /sanitizeQaClickCapture/);
  assert.match(provider, /window\.location\.pathname/);
  assert.doesNotMatch(
    provider,
    /readQaModeFromUrl|QA_STORAGE_KEY|x-qa-mode|window\.location\.search|innerText|\.href|\.className/,
  );
});
