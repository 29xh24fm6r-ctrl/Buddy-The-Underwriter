import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";

type GeminiOcrArgs = {
  fileBytes: Buffer;
  mimeType: string;
  fileName?: string;
};

type GeminiOcrResult = {
  text: string;
  pageCount: number;
};

function countPagesFromText(text: string): number {
  const matches = text.match(/\[Page\s+(\d+)\]/gi) || [];
  let maxPage = 1;
  for (const match of matches) {
    const num = parseInt(match.replace(/\D/g, ""), 10);
    if (!Number.isNaN(num) && num > maxPage) maxPage = num;
  }
  return maxPage;
}

function normalizeMimeType(mimeType: string): string {
  const normalized = String(mimeType || "").toLowerCase().trim();
  if (!normalized) return "application/pdf";

  // Common normalizations
  if (normalized === "image/jpg") return "image/jpeg";

  return normalized;
}

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing Gemini API key. Set GEMINI_API_KEY (preferred) or GOOGLE_API_KEY.",
    );
  }
  return apiKey;
}

function getGeminiModelName(): string {
  return (
    process.env.GEMINI_OCR_MODEL ||
    process.env.GEMINI_MODEL ||
    // Best-effort default (user can override via env)
    "gemini-2.0-flash-exp"
  );
}

export async function runGeminiOcrJob(args: GeminiOcrArgs): Promise<GeminiOcrResult> {
  const { fileBytes, mimeType, fileName } = args;
  const started = Date.now();

  console.log("[GeminiOCR] Starting OCR job", {
    fileName,
    mimeType,
    fileSize: fileBytes.length,
    model: getGeminiModelName(),
  });

  const apiKey = getGeminiApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: getGeminiModelName() });

  const normalizedMimeType = normalizeMimeType(mimeType);
  const base64 = fileBytes.toString("base64");

  const prompt =
    "You are an OCR engine. Extract ALL text from the attached document. " +
    "Return plain text ONLY (no markdown). " +
    "Preserve reading order and include ALL numbers. " +
    "Segment by page and prefix each page with [Page N] on its own line. " +
    "If you cannot reliably segment pages, output everything under [Page 1].";

  try {
    const resp = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: normalizedMimeType,
          data: base64,
        },
      },
    ]);

    const textRaw = resp.response.text() || "";
    const text = textRaw.trim();

    const finalText = text.match(/\[Page\s+\d+\]/i)
      ? text
      : `[Page 1]\n${text}`.trim();

    const pageCount = countPagesFromText(finalText);

    console.log("[GeminiOCR] Completed OCR job", {
      fileName,
      elapsed_ms: Date.now() - started,
      textLength: finalText.length,
      pageCount,
      model: getGeminiModelName(),
    });

    return { text: finalText, pageCount };
  } catch (e: any) {
    console.error("[GeminiOCR] OCR failed", {
      fileName,
      elapsed_ms: Date.now() - started,
      error: e?.message || String(e),
    });
    throw e;
  }
}
