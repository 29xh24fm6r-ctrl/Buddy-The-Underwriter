import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  mockCreateSignwellDocumentFromTemplate,
  mockFetchSignwellDocument,
  mockDownloadSignwellCompletedPdf,
} from "@/lib/esign/signwell/mockClient";

test("mockCreateSignwellDocumentFromTemplate: returns a document with an embedded signing URL", async () => {
  const result = await mockCreateSignwellDocumentFromTemplate({
    templateId: "t1",
    documentName: "SBA_1919 — A B",
    recipients: [{ id: "1", email: "a@b.com", name: "A B" }],
    externalId: "deal:d1:form:SBA_1919:signer:o1",
  });
  assert.match(String(result.id), /^mock_doc_/);
  assert.equal(result.status, "pending");
  assert.equal(result.recipients.length, 1);
  assert.match(result.recipients[0].embedded_signing_url!, /^https:\/\/www\.signwell\.com\/embed\/mock-/);
});

test("mockFetchSignwellDocument: reports completed status", async () => {
  const result = await mockFetchSignwellDocument("123");
  assert.equal(result.status, "completed");
});

test("mockDownloadSignwellCompletedPdf: produces bytes that are a real, loadable PDF", async () => {
  const buf = await mockDownloadSignwellCompletedPdf("document-1");
  assert.ok(buf.length > 0);
  const pdf = await PDFDocument.load(buf);
  assert.equal(pdf.getPageCount(), 1);
});
