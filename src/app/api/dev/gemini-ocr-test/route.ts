import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { runGeminiOcrJob } from "@/lib/ocr/runGeminiOcrJob";
import { classifyDocument } from "@/lib/intelligence/classifyDocument";
import { inferDocumentMetadata } from "@/lib/documents/inferDocumentMetadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertPageMarkers(text: string) {
  const okPage1 = /^\[Page\s+1\]\s*\n/i.test(text);
  const okPage2 = /\n\[Page\s+2\]\s*\n/i.test(text);
  return { ok: okPage1 && okPage2, okPage1, okPage2 };
}

async function buildSamplePdfBytes(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // US Letter (points)
  const pageSize: [number, number] = [612, 792];

  const page1 = pdfDoc.addPage(pageSize);
  page1.drawText("Form 1040", { x: 54, y: 740, size: 20, font });
  page1.drawText("U.S. Individual Income Tax Return", { x: 54, y: 715, size: 12, font });
  page1.drawText("For tax year 2023", { x: 54, y: 695, size: 12, font });
  page1.drawText("Taxpayer: Jane Q Public", { x: 54, y: 660, size: 11, font });
  page1.drawText("SSN: XXX-XX-1234", { x: 54, y: 642, size: 11, font });
  page1.drawText("Total income: 123456", { x: 54, y: 624, size: 11, font });

  const page2 = pdfDoc.addPage(pageSize);
  page2.drawText("Form 1040 (continued)", { x: 54, y: 740, size: 20, font });
  page2.drawText("Tax Year 2023", { x: 54, y: 715, size: 12, font });
  page2.drawText("Signature: ______________________", { x: 54, y: 660, size: 11, font });
  page2.drawText("Date: 01/01/2026", { x: 54, y: 642, size: 11, font });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Dev-only route" }, { status: 404 });
  }

  // Optional per-request overrides to speed up debugging/access without restarts.
  // Example: /api/dev/gemini-ocr-test?model=gemini-1.5-flash
  const url = new URL(req.url);
  const modelOverride = url.searchParams.get("model");
  const locationOverride = url.searchParams.get("location");

  if (modelOverride) process.env.GEMINI_OCR_MODEL = modelOverride;
  if (locationOverride) process.env.GOOGLE_CLOUD_LOCATION = locationOverride;

  const expectedToken = process.env.DEV_INTERNAL_TOKEN;
  if (expectedToken) {
    const got = req.headers.get("x-dev-token") || "";
    if (got !== expectedToken) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const fileBytes = await buildSamplePdfBytes();
    const ocr = await runGeminiOcrJob({
      fileBytes,
      mimeType: "application/pdf",
      fileName: "sample-1040-2p.pdf",
    });

    const markers = assertPageMarkers(ocr.text);
    const deterministic = await classifyDocument({ ocrText: ocr.text });
    const meta = inferDocumentMetadata({ originalFilename: null, extractedText: ocr.text });

    const expected = {
      classifyDocument_doc_type: "IRS_1040",
      inferDocumentMetadata_document_type: "personal_tax_return",
    } as const;

    const checks = {
      pageMarkers: markers,
      docTypes: {
        classifyDocument: {
          ok: deterministic.doc_type === expected.classifyDocument_doc_type,
          got: deterministic.doc_type,
          expected: expected.classifyDocument_doc_type,
        },
        inferDocumentMetadata: {
          ok: meta.document_type === expected.inferDocumentMetadata_document_type,
          got: meta.document_type,
          expected: expected.inferDocumentMetadata_document_type,
        },
      },
    };

    return NextResponse.json({
      ok: checks.pageMarkers.ok && checks.docTypes.classifyDocument.ok && checks.docTypes.inferDocumentMetadata.ok,
      ocr: { pageCount: ocr.pageCount, textLength: ocr.text.length },
      model: process.env.GEMINI_OCR_MODEL || process.env.GEMINI_MODEL || null,
      location: process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_REGION || null,
      checks,
      classification: { classifyDocument: deterministic, inferDocumentMetadata: meta },
      textPreview: ocr.text.slice(0, 1200),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 },
    );
  }
}
