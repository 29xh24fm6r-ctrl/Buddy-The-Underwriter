import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  mockCreateDocusealSubmission,
  mockFetchDocusealSubmission,
  mockDownloadDocusealSignedPdf,
  mockDownloadDocusealAuditTrail,
} from "@/lib/esign/docuseal/mockClient";

test("mockCreateDocusealSubmission: returns a submission with a submitter slug", async () => {
  const result = await mockCreateDocusealSubmission({
    templateId: "t1",
    submitters: [{ email: "a@b.com", name: "A B" }],
    externalId: "deal:d1:form:SBA_1919:signer:o1",
  });
  assert.equal(typeof result.id, "number");
  assert.equal(result.status, "pending");
  assert.equal(result.submitters.length, 1);
  assert.match(result.submitters[0].slug, /^mock-slug-/);
});

test("mockFetchDocusealSubmission: reports completed status", async () => {
  const result = await mockFetchDocusealSubmission("123");
  assert.equal(result.status, "completed");
});

test("mockDownloadDocusealSignedPdf: produces bytes that are a real, loadable PDF", async () => {
  const buf = await mockDownloadDocusealSignedPdf("submission-1");
  assert.ok(buf.length > 0);
  const pdf = await PDFDocument.load(buf);
  assert.equal(pdf.getPageCount(), 1);
});

test("mockDownloadDocusealAuditTrail: produces valid JSON bytes marked as a mock", async () => {
  const buf = await mockDownloadDocusealAuditTrail("submission-1");
  assert.ok(buf);
  const parsed = JSON.parse(buf!.toString());
  assert.equal(parsed.mock, true);
});
