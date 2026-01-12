import "server-only";

import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { getOcrEnvDiagnostics } from "@/lib/ocr/ocrEnvDiagnostics";
import { runGeminiOcrJob } from "@/lib/ocr/runGeminiOcrJob";

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
  page1.drawText("Gemini OCR Health Check", { x: 54, y: 740, size: 20, font });
  page1.drawText("[Buddy] Sample Page 1", { x: 54, y: 715, size: 12, font });
  page1.drawText("Total income: 123456", { x: 54, y: 695, size: 12, font });

  const page2 = pdfDoc.addPage(pageSize);
  page2.drawText("Gemini OCR Health Check", { x: 54, y: 740, size: 20, font });
  page2.drawText("[Buddy] Sample Page 2", { x: 54, y: 715, size: 12, font });
  page2.drawText("Signature: ______________________", { x: 54, y: 695, size: 12, font });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

/**
 * GET /api/admin/health/gemini
 *
 * Admin-only live probe that actually calls Vertex/Gemini OCR.
 * Useful to verify that the deployed environment has *working* permissions.
 */
export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unauthorized" },
      { status: 401 },
    );
  }

  const ocr = getOcrEnvDiagnostics();

  if (!ocr.useGeminiOcrEnabled) {
    return NextResponse.json(
      {
        ok: false,
        error: "Gemini OCR is disabled. Set USE_GEMINI_OCR=true and redeploy.",
        ocr,
      },
      { status: 200 },
    );
  }

  const started = Date.now();

  try {
    const fileBytes = await buildSamplePdfBytes();
    const result = await runGeminiOcrJob({
      fileBytes,
      mimeType: "application/pdf",
      fileName: "gemini-healthcheck.pdf",
    });

    const markers = assertPageMarkers(result.text);

    return NextResponse.json(
      {
        ok: true,
        ocr,
        probe: {
          elapsed_ms: Date.now() - started,
          pageCount: result.pageCount,
          textLength: result.text.length,
          model: result.model,
          pageMarkers: markers,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        ocr,
        error: e?.message || String(e),
        cause: e?.cause?.message ? String(e.cause.message) : undefined,
        elapsed_ms: Date.now() - started,
      },
      { status: 500 },
    );
  }
}
