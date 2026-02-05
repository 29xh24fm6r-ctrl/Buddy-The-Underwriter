import test from "node:test";
import assert from "node:assert/strict";

/**
 * Google Document AI Module Tests
 *
 * These tests verify the Document AI module structure and contracts
 * without actually calling Google APIs (which would require credentials).
 */

// ─── Source Structure Verification ───────────────────────────────────────────

test("extractWithGoogleDocAi imports DocumentProcessorServiceClient", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("DocumentProcessorServiceClient"),
    "Module must import DocumentProcessorServiceClient from @google-cloud/documentai",
  );
});

test("extractWithGoogleDocAi uses processDocument API", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("processDocument"),
    "Module must call client.processDocument()",
  );
});

test("extractWithGoogleDocAi uses rawDocument for inline content", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("rawDocument"),
    "Module must use rawDocument for inline content submission",
  );
});

test("extractWithGoogleDocAi checks GOOGLE_DOCAI_ENABLED flag", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("isGoogleDocAiEnabled"),
    "Module must check isGoogleDocAiEnabled() before executing",
  );
});

// ─── Environment Configuration ───────────────────────────────────────────────

test("extractWithGoogleDocAi supports GOOGLE_APPLICATION_CREDENTIALS_JSON", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
    "Module must support GOOGLE_APPLICATION_CREDENTIALS_JSON for Vercel",
  );
});

test("extractWithGoogleDocAi supports tax processor config", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("GOOGLE_DOCAI_TAX_PROCESSOR_ID"),
    "Module must support GOOGLE_DOCAI_TAX_PROCESSOR_ID",
  );
});

test("extractWithGoogleDocAi supports financial processor config", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("GOOGLE_DOCAI_FINANCIAL_PROCESSOR_ID"),
    "Module must support GOOGLE_DOCAI_FINANCIAL_PROCESSOR_ID",
  );
});

// ─── Provider Metrics ────────────────────────────────────────────────────────

test("extractWithGoogleDocAi includes processorId in provider_metrics", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  // Check ProviderMetrics type includes processorId
  assert.ok(
    src.includes("processorId?:") || src.includes("processorId:"),
    "ProviderMetrics must include processorId",
  );
});

test("extractWithGoogleDocAi includes latencyMs in provider_metrics", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("latencyMs"),
    "ProviderMetrics must include latencyMs",
  );
});

test("extractWithGoogleDocAi includes textLength in provider_metrics", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("textLength"),
    "ProviderMetrics must include textLength for extracted text size",
  );
});

// ─── Return Shape ────────────────────────────────────────────────────────────

test("extractWithGoogleDocAi returns extracted text", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("doc?.text") || src.includes("document?.text"),
    "Module must extract text from Document AI response",
  );
});

test("extractWithGoogleDocAi returns full JSON response", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  // Check that the function returns the full result object
  assert.ok(
    src.includes("json: result"),
    "Module must return full DocAI response as json for audit",
  );
});

// ─── Ledger Logging ──────────────────────────────────────────────────────────

test("extractWithGoogleDocAi logs to ledger on completion", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../extractWithGoogleDocAi.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes('eventKey: "extract.docai.completed"'),
    "Module must log extract.docai.completed event to ledger",
  );
});
