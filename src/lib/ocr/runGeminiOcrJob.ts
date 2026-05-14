import "server-only";
import { GoogleGenAI } from "@google/genai";
import { ensureGcpAdcBootstrap, getVertexAuthOptions } from "@/lib/gcpAdcBootstrap";
import { MODEL_OCR } from "@/lib/ai/models";
import { getVertexLocation } from "@/lib/ai/vertexLocation";
import { classifySdkError } from "@/lib/extraction/sdkResponseGuard";

type GeminiOcrArgs = {
  fileBytes: Buffer;
  mimeType: string;
  fileName?: string;
};

type GeminiOcrResult = {
  text: string;
  pageCount: number;
  model: string;
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

function getGoogleProjectId(): string {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCS_PROJECT_ID ||
    process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT (recommended) or GOOGLE_PROJECT_ID.",
    );
  }
  return projectId;
}

function getGeminiModelFromEnv(): string | null {
  const raw = process.env.GEMINI_OCR_MODEL || process.env.GEMINI_MODEL;
  const normalized = typeof raw === "string" ? raw.trim() : "";
  return normalized ? normalized : null;
}

function getGeminiModelCandidates(): string[] {
  const envModel = getGeminiModelFromEnv();

  // Phase 93: model strings sourced from the central registry. The historical
  // Vertex fallback chain (gemini-2.0-flash / gemini-1.5-*) has been retired
  // by Google; MODEL_OCR points at the current supported flash model.
  const candidates = [
    envModel,
    MODEL_OCR,
  ].filter(Boolean) as string[];

  return Array.from(new Set(candidates));
}

function isVertexModelNotFoundError(e: any): boolean {
  const msg = String(e?.message || "");
  // VertexAI.ClientError tends to include this text.
  if (msg.includes("got status: 404")) return true;
  if (msg.includes("404 Not Found")) return true;
  // Some errors embed JSON with code/status.
  if (msg.includes('"code":404')) return true;
  if (msg.includes('"status":"NOT_FOUND"')) return true;
  return false;
}

export async function runGeminiOcrJob(args: GeminiOcrArgs): Promise<GeminiOcrResult> {
  const { fileBytes, mimeType, fileName } = args;
  const started = Date.now();

  const modelCandidates = getGeminiModelCandidates();

  console.log("[GeminiOCR] Starting OCR job", {
    fileName,
    mimeType,
    fileSize: fileBytes.length,
    modelCandidates,
  });

  await ensureGcpAdcBootstrap();
  const googleAuthOptions = await getVertexAuthOptions();
  // SPEC-VERTEX-SDK-MIGRATION-1: @google/genai with vertexai:true
  const ai = new GoogleGenAI({
    vertexai: true,
    project: getGoogleProjectId(),
    location: getVertexLocation(),
    ...(googleAuthOptions ? { googleAuthOptions: googleAuthOptions as any } : {}),
  });

  const normalizedMimeType = normalizeMimeType(mimeType);
  const base64 = fileBytes.toString("base64");

  const prompt =
    "You are an OCR engine. Extract ALL text from the attached document. " +
    "Return plain text ONLY (no markdown). " +
    "Preserve reading order and include ALL numbers. " +
    "Segment by page and prefix each page with [Page N] on its own line. " +
    "If you cannot reliably segment pages, output everything under [Page 1].";

  let lastError: any = null;
  const tried: string[] = [];

  const OCR_TIMEOUT_MS = 120_000; // 120s per model attempt

  for (const modelName of modelCandidates) {
    tried.push(modelName);

    try {
      // SPEC-VERTEX-SDK-MIGRATION-1: ai.models.generateContent unified call.
      // Model is selected per-attempt inside the fallback loop.
      const generatePromise = ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: normalizedMimeType,
                  data: base64,
                },
              },
            ],
          },
        ],
      });

      const resp = await Promise.race([
        generatePromise,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error(`OCR timeout after ${OCR_TIMEOUT_MS / 1000}s (model: ${modelName})`)),
            OCR_TIMEOUT_MS,
          ),
        ),
      ]);

      // SPEC-VERTEX-SDK-MIGRATION-1: @google/genai response shape — no `.response` wrapper
      const parts = (resp as any)?.candidates?.[0]?.content?.parts ?? [];
      const textRaw =
        (resp as any)?.text ??
        parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("") ??
        "";
      const text = String(textRaw).trim();

      const finalText = text.match(/\[Page\s+\d+\]/i)
        ? text
        : `[Page 1]\n${text}`.trim();

      const pageCount = countPagesFromText(finalText);

      console.log("[GeminiOCR] Completed OCR job", {
        fileName,
        elapsed_ms: Date.now() - started,
        textLength: finalText.length,
        pageCount,
        model: modelName,
        triedModels: tried,
      });

      return { text: finalText, pageCount, model: modelName };
    } catch (e: any) {
      lastError = e;

      // SPEC-VERTEX-SDK-MIGRATION-1: classify SDK errors. HTML-response failures
      // get a wrapped throw with a clear prefix so processDocExtractionOutbox
      // records "SDK_HTML_RESPONSE:" in last_error verbatim.
      const classification = classifySdkError(e);
      if (classification.isHtmlResponse) {
        console.error("[GeminiOCR] SDK_HTML_RESPONSE — Vertex returned HTML where JSON expected", {
          fileName,
          model: modelName,
          rawSnippet: classification.rawSnippet,
        });
        throw new Error(`SDK_HTML_RESPONSE: ${classification.rawSnippet.slice(0, 120)}`, { cause: e });
      }

      const isTimeout = e?.message?.includes("OCR timeout");
      if (isVertexModelNotFoundError(e) || isTimeout) {
        console.warn(`[GeminiOCR] ${isTimeout ? "Timeout" : "Model unavailable"}, trying next`, {
          fileName,
          model: modelName,
          elapsed_ms: Date.now() - started,
        });
        continue;
      }

      console.error("[GeminiOCR] OCR failed", {
        fileName,
        model: modelName,
        elapsed_ms: Date.now() - started,
        error: e?.message || String(e),
      });
      throw e;
    }
  }

  const msg =
    "Gemini OCR failed: none of the candidate models were available to this project. " +
    `Tried: ${tried.join(", ")}. Last error: ${String(lastError?.message || lastError)}`;
  console.error("[GeminiOCR] OCR failed", { fileName, elapsed_ms: Date.now() - started, tried });
  throw new Error(msg, { cause: lastError });
}
