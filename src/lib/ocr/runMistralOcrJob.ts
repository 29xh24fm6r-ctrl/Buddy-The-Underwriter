// src/lib/ocr/runMistralOcrJob.ts
import "server-only";
import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_OCR } from "@/lib/ai/models";

export type MistralOcrArgs = {
  fileBytes: Buffer;
  mimeType: string;
  fileName?: string;
};

export type MistralOcrResult = {
  text: string;
  pageCount: number;
  model: string;
};

const OCR_TIMEOUT_MS = 120_000; // 120s, matching runGeminiOcrJob's per-attempt timeout

// Mistral's OCR endpoint takes an image_url chunk for raster images and a
// document_url chunk for everything else (PDF, docx, pptx, ...) — both
// accept a data: URI, not just a real hosted URL.
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/tiff",
  "image/tif",
  "image/bmp",
  "image/avif",
]);

function normalizeMimeType(mimeType: string): string {
  const normalized = String(mimeType || "").toLowerCase().trim();
  if (!normalized) return "application/pdf";
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized;
}

export async function runMistralOcrJob(args: MistralOcrArgs): Promise<MistralOcrResult> {
  const { fileBytes, mimeType, fileName } = args;
  const started = Date.now();

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing MISTRAL_API_KEY environment variable");
  }

  const normalizedMimeType = normalizeMimeType(mimeType);
  const base64 = fileBytes.toString("base64");
  const dataUrl = `data:${normalizedMimeType};base64,${base64}`;

  const document = IMAGE_MIME_TYPES.has(normalizedMimeType)
    ? ({ type: "image_url" as const, imageUrl: dataUrl })
    : ({ type: "document_url" as const, documentUrl: dataUrl, documentName: fileName ?? undefined });

  console.log("[MistralOCR] Starting OCR job", {
    fileName,
    mimeType: normalizedMimeType,
    fileSize: fileBytes.length,
    model: MISTRAL_OCR,
    documentType: document.type,
  });

  const client = new Mistral({ apiKey });

  try {
    const ocrPromise = client.ocr.process({
      model: MISTRAL_OCR,
      document,
    });

    const resp = await Promise.race([
      ocrPromise,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error(`Mistral OCR timeout after ${OCR_TIMEOUT_MS / 1000}s`)),
          OCR_TIMEOUT_MS,
        ),
      ),
    ]);

    const pages = resp?.pages ?? [];
    if (!pages.length) {
      throw new Error("No pages returned in Mistral OCR response");
    }

    // Mistral returns real per-page markdown (0-indexed) rather than
    // self-reported [Page N] markers, so build the same marker convention
    // runGeminiOcrJob/runOcrJob's buildAuditMapFromMarkers expects.
    const text = pages
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((p) => `[Page ${p.index + 1}]\n${String(p.markdown ?? "").trim()}`)
      .join("\n\n");

    const elapsed = Date.now() - started;

    console.log("[MistralOCR] Completed OCR job", {
      fileName,
      elapsed_ms: elapsed,
      textLength: text.length,
      pageCount: pages.length,
      model: resp.model || MISTRAL_OCR,
    });

    return { text, pageCount: pages.length, model: resp.model || MISTRAL_OCR };
  } catch (error: any) {
    const elapsed = Date.now() - started;

    console.error("[MistralOCR] OCR job failed", {
      fileName,
      elapsed_ms: elapsed,
      error: error?.message || String(error),
    });

    throw error;
  }
}
