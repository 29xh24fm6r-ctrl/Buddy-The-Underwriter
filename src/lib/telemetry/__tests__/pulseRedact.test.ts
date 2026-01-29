import test from "node:test";
import assert from "node:assert/strict";

import { redactLedgerPayload } from "@/lib/telemetry/pulseRedact";

// ─── Test A: Redaction ──────────────────────────────────────────────────────

test("redaction: OCR text is never emitted", () => {
  const input = {
    deal_id: "deal-1",
    event_key: "document.classified",
    ocr_text: "Full OCR content of a tax return with SSN 123-45-6789",
    extracted_text: "Some extracted content here",
    document_type: "BUSINESS_TAX_RETURN",
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.deal_id, "deal-1");
  assert.equal(result.document_type, "BUSINESS_TAX_RETURN");
  assert.equal(result.ocr_text, undefined, "OCR text must be dropped");
  assert.equal(result.extracted_text, undefined, "Extracted text must be dropped");
});

test("redaction: filenames are hashed, not dropped", () => {
  const input = {
    deal_id: "deal-1",
    filename: "John_Smith_2024_Tax_Return.pdf",
    original_filename: "secret_document.xlsx",
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.deal_id, "deal-1");
  assert.ok(
    typeof result.filename === "string" && result.filename.startsWith("<"),
    "filename must be hashed",
  );
  assert.ok(
    typeof result.filename === "string" && result.filename.endsWith(".pdf>"),
    "filename hash must preserve extension",
  );
  assert.notEqual(result.filename, "John_Smith_2024_Tax_Return.pdf", "original name must not appear");
  assert.ok(
    typeof result.original_filename === "string" && result.original_filename.startsWith("<"),
    "original_filename must be hashed",
  );
});

test("redaction: email addresses are masked", () => {
  const input = {
    deal_id: "deal-1",
    event_key: "some.event",
    confidence: 0.95,
    // Nested object with an email in a string value
    reason: "Matched borrower john.doe@example.com",
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.deal_id, "deal-1");
  assert.equal(result.confidence, 0.95);
  assert.equal(result.reason, "<redacted:pii>", "Email in string must be masked");
});

test("redaction: SSN patterns are masked", () => {
  const input = {
    deal_id: "deal-1",
    reason: "SSN: 123-45-6789",
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.reason, "<redacted:pii>");
});

test("redaction: phone numbers are masked", () => {
  const input = {
    deal_id: "deal-1",
    reason: "Contact: (555) 123-4567",
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.reason, "<redacted:pii>");
});

test("redaction: long strings (likely document text) are dropped", () => {
  const input = {
    deal_id: "deal-1",
    reason: "A".repeat(501),
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.reason, "<redacted:long_string>");
});

test("redaction: allowlisted fields pass through", () => {
  const input = {
    deal_id: "deal-1",
    bank_id: "bank-1",
    artifact_id: "art-1",
    checklist_key: "IRS_BUSINESS_3Y",
    document_type: "BUSINESS_TAX_RETURN",
    doc_year: 2024,
    doc_years: [2024, 2023, 2022],
    confidence: 0.96,
    match_source: "ai_classification",
    status: "ok",
    duration_ms: 1234,
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.deal_id, "deal-1");
  assert.equal(result.bank_id, "bank-1");
  assert.equal(result.artifact_id, "art-1");
  assert.equal(result.checklist_key, "IRS_BUSINESS_3Y");
  assert.equal(result.document_type, "BUSINESS_TAX_RETURN");
  assert.equal(result.doc_year, 2024);
  assert.deepEqual(result.doc_years, [2024, 2023, 2022]);
  assert.equal(result.confidence, 0.96);
  assert.equal(result.match_source, "ai_classification");
  assert.equal(result.status, "ok");
  assert.equal(result.duration_ms, 1234);
});

test("redaction: non-allowlisted scalar fields are dropped", () => {
  const input = {
    deal_id: "deal-1",
    secret_internal_field: "should not appear",
    user_ip_address: "192.168.1.1",
    borrower_name: "John Smith",
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.deal_id, "deal-1");
  assert.equal(result.secret_internal_field, undefined);
  assert.equal(result.user_ip_address, undefined);
  assert.equal(result.borrower_name, undefined);
});

test("redaction: blocked keys are always dropped regardless of allowlist", () => {
  const input = {
    deal_id: "deal-1",
    raw_json: { nested: "data" },
    extraction_json: { nested: "data" },
    ai_extracted_json: { nested: "data" },
    stack: "Error: something\n  at function...",
    address: "123 Main St",
    email: "test@example.com",
    phone: "555-1234",
    ssn: "123-45-6789",
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.deal_id, "deal-1");
  assert.equal(result.raw_json, undefined);
  assert.equal(result.extraction_json, undefined);
  assert.equal(result.ai_extracted_json, undefined);
  assert.equal(result.stack, undefined);
  assert.equal(result.address, undefined);
  assert.equal(result.email, undefined);
  assert.equal(result.phone, undefined);
  assert.equal(result.ssn, undefined);
});

test("redaction: null and undefined inputs return null", () => {
  assert.equal(redactLedgerPayload(null), null);
  assert.equal(redactLedgerPayload(undefined), null);
});

test("redaction: primitives pass through", () => {
  assert.equal(redactLedgerPayload(42), 42);
  assert.equal(redactLedgerPayload(true), true);
  assert.equal(redactLedgerPayload("short string"), "short string");
});

test("redaction: nested objects are recursively filtered", () => {
  const input = {
    deal_id: "deal-1",
    attempted: {
      canonicalType: "BUSINESS_TAX_RETURN",
      secret_data: "should be dropped",
      confidence: 0.9,
    },
  };

  const result = redactLedgerPayload(input) as Record<string, unknown>;
  assert.equal(result.deal_id, "deal-1");
  // attempted is not in allowlist but is an object, so it gets recursively filtered
  const attempted = result.attempted as Record<string, unknown>;
  assert.ok(attempted, "nested object should survive if it has allowed children");
  assert.equal(attempted.confidence, 0.9, "nested allowed field should survive");
  assert.equal(attempted.secret_data, undefined, "nested non-allowed scalar should be dropped");
});

// ─── Test B: Idempotency (structural) ───────────────────────────────────────

test("idempotency: redacting the same input twice produces identical output", () => {
  const input = {
    deal_id: "deal-1",
    document_type: "PERSONAL_TAX_RETURN",
    confidence: 0.88,
    filename: "tax_2024.pdf",
  };

  const result1 = redactLedgerPayload(input);
  const result2 = redactLedgerPayload(input);
  assert.deepEqual(result1, result2);
});

test("idempotency: filename hashing is deterministic", () => {
  const input1 = { filename: "test_file.pdf", deal_id: "d1" };
  const input2 = { filename: "test_file.pdf", deal_id: "d1" };

  const r1 = redactLedgerPayload(input1) as Record<string, unknown>;
  const r2 = redactLedgerPayload(input2) as Record<string, unknown>;
  assert.equal(r1.filename, r2.filename, "same filename must produce same hash");
});

// ─── Test C: Kill switch (structural — tests the redaction layer contract) ──

test("kill switch: forwarder core includes PULSE_TELEMETRY_ENABLED check", async () => {
  const fs = await import("node:fs");
  const corePath = "src/lib/pulse/forwardLedgerCore.ts";
  const source = fs.readFileSync(corePath, "utf-8");

  assert.ok(
    source.includes('PULSE_TELEMETRY_ENABLED'),
    "Core must check PULSE_TELEMETRY_ENABLED env var",
  );
  assert.ok(
    source.includes('"telemetry_disabled"'),
    "Core must return telemetry_disabled reason when kill switch is off",
  );
});

test("kill switch: forwarder route requires authorization", async () => {
  const fs = await import("node:fs");
  const routeSource = fs.readFileSync("src/app/api/pulse/forward-ledger/route.ts", "utf-8");

  assert.ok(
    routeSource.includes("PULSE_FORWARDER_TOKEN"),
    "Route must check PULSE_FORWARDER_TOKEN",
  );
  assert.ok(
    routeSource.includes("Unauthorized"),
    "Route must return Unauthorized on failed auth",
  );
});

test("kill switch: forwarder core marks events as forwarded (idempotency)", async () => {
  const fs = await import("node:fs");
  const coreSource = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    coreSource.includes("pulse_forwarded_at"),
    "Core must update pulse_forwarded_at to prevent re-forwarding",
  );
  assert.ok(
    coreSource.includes("pulse_forward_attempts"),
    "Core must track forward attempts",
  );
});
