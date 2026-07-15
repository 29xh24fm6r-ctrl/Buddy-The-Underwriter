/**
 * Mock DocuSeal client — test-mode only, gated by isMockVendorsEnabled()
 * at every call site. Used by the mock-complete-esign action to drive the
 * REAL handleDocusealWebhook() (src/lib/esign/docuseal/service.ts) — only
 * the vendor HTTP calls are faked; the IAL2 re-check-at-completion,
 * signed_documents insert, and storage upload are all real.
 */

import crypto from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Unused by mockRequestSignature (which builds its own fake submission id
// directly) — exists only so callers needing the full DocusealClient shape
// (e.g. handleDocusealWebhook's deps) never have to fall back to the real
// createDocusealSubmission in mock mode.
export async function mockCreateDocusealSubmission(_args: {
  templateId: string;
  submitters: Array<{ email: string; name: string; role?: string; fields?: Record<string, unknown> }>;
  externalId: string;
  sendEmail?: boolean;
  signOrdered?: boolean;
}): Promise<{ id: number; status: string; submitters: Array<{ id: number; slug: string }> }> {
  const id = Number(`${Date.now()}`.slice(-6)) + Math.floor(Math.random() * 1000);
  return { id, status: "pending", submitters: [{ id: 1, slug: `mock-slug-${crypto.randomBytes(4).toString("hex")}` }] };
}

export async function mockFetchDocusealSubmission(submissionId: string): Promise<{
  id: number;
  status: string;
  submitters: Array<{ id: number; slug: string }>;
}> {
  return {
    id: Number(submissionId) || 1,
    status: "completed",
    submitters: [{ id: 1, slug: `mock-slug-${submissionId}` }],
  };
}

export async function mockDownloadDocusealSignedPdf(submissionId: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("MOCK SIGNED DOCUMENT — TEST MODE ONLY, NOT A REAL SIGNATURE", {
    x: 50,
    y: 720,
    size: 14,
    font,
  });
  page.drawText(`Mock DocuSeal submission: ${submissionId}`, { x: 50, y: 690, size: 10, font });
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

export async function mockDownloadDocusealAuditTrail(submissionId: string): Promise<Buffer | null> {
  return Buffer.from(
    JSON.stringify({ mock: true, submissionId, note: "Test-mode audit trail — not a real signature event log." }),
  );
}
