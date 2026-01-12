import "server-only";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { runGeminiOcrJob } from "@/lib/ocr/runGeminiOcrJob";
import { getOcrEnvDiagnostics } from "@/lib/ocr/ocrEnvDiagnostics";

function assertPageMarkers(text: string) {
  const okPage1 = /^\[Page\s+1\]\s*\n/i.test(text);
  const okPage2 = /\n\[Page\s+2\]\s*\n/i.test(text);
  return { ok: okPage1 && okPage2, okPage1, okPage2 };
}

async function buildSamplePdfBytes(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageSize: [number, number] = [612, 792];

  const page1 = pdfDoc.addPage(pageSize);
  page1.drawText("Gemini OCR Smoke Test", { x: 54, y: 740, size: 20, font });
  page1.drawText("[Buddy] Sample Page 1", { x: 54, y: 715, size: 12, font });
  page1.drawText("Total income: 123456", { x: 54, y: 695, size: 12, font });

  const page2 = pdfDoc.addPage(pageSize);
  page2.drawText("Gemini OCR Smoke Test", { x: 54, y: 740, size: 20, font });
  page2.drawText("[Buddy] Sample Page 2", { x: 54, y: 715, size: 12, font });
  page2.drawText("Signature: ______________________", { x: 54, y: 695, size: 12, font });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function runHttpMode() {
  const url = process.env.GEMINI_OCR_TEST_URL;
  if (!url) {
    throw new Error(
      "GEMINI_OCR_TEST_URL is not set. Either set it to a running Buddy dev route (/api/dev/gemini-ocr-test), or run without it for direct Vertex mode.",
    );
  }

  const token = process.env.DEV_INTERNAL_TOKEN;

  const res = await fetch(url, {
    method: "GET",
    headers: token ? { "x-dev-token": token } : {},
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // fall through
  }

  if (!res.ok) {
    console.error("Request failed", { status: res.status, body: json ?? text });
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(json, null, 2));

  if (!json?.ok) {
    process.exitCode = 2;
  }
}

async function runDirectMode() {
  const diag = getOcrEnvDiagnostics();

  console.log("[gemini-ocr-smoke] env diagnostics", {
    useGeminiOcrEnabled: diag.useGeminiOcrEnabled,
    hasGoogleProject: diag.hasGoogleProject,
    hasGoogleCredentialsHint: diag.hasGoogleCredentialsHint,
    googleLocation: diag.googleLocation,
    geminiModel: diag.geminiModel,
  });

  if (!diag.useGeminiOcrEnabled) {
    throw new Error("USE_GEMINI_OCR is not true. Set USE_GEMINI_OCR=true.");
  }

  const fileBytes = await buildSamplePdfBytes();

  const started = Date.now();
  const result = await runGeminiOcrJob({
    fileBytes,
    mimeType: "application/pdf",
    fileName: "gemini-smoke-test.pdf",
  });

  const markers = assertPageMarkers(result.text);

  console.log("[gemini-ocr-smoke] result", {
    elapsed_ms: Date.now() - started,
    pageCount: result.pageCount,
    textLength: result.text.length,
    pageMarkers: markers,
  });

  if (!markers.ok) {
    throw new Error(
      `OCR output missing expected page markers. okPage1=${markers.okPage1} okPage2=${markers.okPage2}`,
    );
  }
}

async function main() {
  // Back-compat: if a URL is provided, keep using the in-app dev route.
  // Otherwise, run direct mode (no local server required).
  if (process.env.GEMINI_OCR_TEST_URL) {
    await runHttpMode();
    return;
  }

  await runDirectMode();
  console.log("[gemini-ocr-smoke] OK");
}

main().catch((e) => {
  console.error("\nTEST FAILED:", e?.message || e);
  process.exitCode = 1;
});
