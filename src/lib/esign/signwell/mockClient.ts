/**
 * Mock SignWell client — test-mode only, gated by isMockVendorsEnabled()
 * at every call site. Used by the mock-complete-esign action to drive the
 * REAL handleSignwellWebhook() (src/lib/esign/signwell/service.ts) — only
 * the vendor HTTP calls are faked; the IAL2 re-check-at-completion,
 * signed_documents insert, and storage upload are all real.
 *
 * Only 3 methods, matching SignwellClient exactly — unlike the old DocuSeal
 * mock this replaces, there is no separate audit-trail download: SignWell's
 * Audit & Lock trail is appended inside the same completed PDF.
 */

import crypto from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Unused by mockRequestSignature (which builds its own fake document id
// directly) — exists only so callers needing the full SignwellClient shape
// never have to fall back to the real createSignwellDocumentFromTemplate in
// mock mode.
export async function mockCreateSignwellDocumentFromTemplate(_args: {
  templateId: string;
  documentName: string;
  recipients: Array<{ id: string; email: string; name: string; placeholderName?: string }>;
  externalId: string;
  embeddedSigning?: boolean;
  redirectUrl?: string;
  templateFields?: Array<{ api_id: string; value: string }>;
}): Promise<{ id: string | number; status: string; recipients: Array<{ id: string | number; signing_url?: string | null; embedded_signing_url?: string | null }> }> {
  const id = `mock_doc_${crypto.randomBytes(6).toString("hex")}`;
  return {
    id,
    status: "pending",
    recipients: [{ id: "1", embedded_signing_url: `https://www.signwell.com/embed/mock-${crypto.randomBytes(4).toString("hex")}` }],
  };
}

export async function mockFetchSignwellDocument(documentId: string): Promise<{
  id: string | number;
  status: string;
  recipients: Array<{ id: string | number; signing_url?: string | null; embedded_signing_url?: string | null }>;
}> {
  return {
    id: documentId,
    status: "completed",
    recipients: [{ id: "1", embedded_signing_url: `https://www.signwell.com/embed/mock-${documentId}` }],
  };
}

export async function mockDownloadSignwellCompletedPdf(documentId: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("MOCK SIGNED DOCUMENT — TEST MODE ONLY, NOT A REAL SIGNATURE", {
    x: 50,
    y: 720,
    size: 14,
    font,
  });
  page.drawText(`Mock SignWell document: ${documentId}`, { x: 50, y: 690, size: 10, font });
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
