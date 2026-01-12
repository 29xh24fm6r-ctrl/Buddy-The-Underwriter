import "server-only";
import { VertexAI } from "@google-cloud/vertexai";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";

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

type ServiceAccountJson = {
  type: string;
  project_id?: string;
  private_key?: string;
  client_email?: string;
};

async function ensureGoogleAdcConfigured(): Promise<void> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;

  const rawJson =
    process.env.GEMINI_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
    // Back-compat: some setups paste the service account JSON into GEMINI_API_KEY.
    process.env.GEMINI_API_KEY;

  if (!rawJson) {
    throw new Error(
      "Missing Google credentials for Gemini OCR. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file path, or set GEMINI_SERVICE_ACCOUNT_JSON to the JSON contents.",
    );
  }

  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(rawJson) as ServiceAccountJson;
  } catch {
    throw new Error(
      "Invalid JSON in GEMINI_SERVICE_ACCOUNT_JSON/GOOGLE_SERVICE_ACCOUNT_JSON (or GEMINI_API_KEY). Provide valid service-account JSON, or set GOOGLE_APPLICATION_CREDENTIALS to a file path.",
    );
  }

  const isServiceAccount =
    parsed?.type === "service_account" &&
    typeof parsed.private_key === "string" &&
    typeof parsed.client_email === "string";

  if (!isServiceAccount) {
    throw new Error(
      "Google credentials JSON must be a service_account (must include type, client_email, private_key).",
    );
  }

  if (!process.env.GOOGLE_CLOUD_PROJECT && typeof parsed.project_id === "string") {
    process.env.GOOGLE_CLOUD_PROJECT = parsed.project_id;
  }

  const filePath = `/tmp/buddy-google-sa-${crypto.randomUUID()}.json`;
  await fs.writeFile(filePath, JSON.stringify(parsed), { encoding: "utf8", mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = filePath;
}

function getGoogleProjectId(): string {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT (recommended) or GOOGLE_PROJECT_ID.",
    );
  }
  return projectId;
}

function getGoogleLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_REGION || "us-central1";
}

function getGeminiModelFromEnv(): string | null {
  const raw = process.env.GEMINI_OCR_MODEL || process.env.GEMINI_MODEL;
  const normalized = typeof raw === "string" ? raw.trim() : "";
  return normalized ? normalized : null;
}

function getGeminiModelCandidates(): string[] {
  const envModel = getGeminiModelFromEnv();

  // Order matters: try explicit override first, then sensible defaults.
  // These model names are Vertex publisher model IDs.
  const candidates = [
    envModel,
    // Prefer newer “2.0 flash” where available.
    "gemini-2.0-flash",
    "gemini-2.0-flash-exp",
    // Widely available 1.5 models.
    "gemini-1.5-flash",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-002",
    "gemini-1.5-pro",
    "gemini-1.5-pro-001",
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

  await ensureGoogleAdcConfigured();
  const vertexAI = new VertexAI({
    project: getGoogleProjectId(),
    location: getGoogleLocation(),
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

  for (const modelName of modelCandidates) {
    tried.push(modelName);

    try {
      const model = vertexAI.getGenerativeModel({ model: modelName });
      const resp = await model.generateContent({
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

      const parts = (resp as any)?.response?.candidates?.[0]?.content?.parts ?? [];
      const textRaw =
        parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("") || "";
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
        model: modelName,
        triedModels: tried,
      });

      return { text: finalText, pageCount, model: modelName };
    } catch (e: any) {
      lastError = e;

      if (isVertexModelNotFoundError(e)) {
        console.warn("[GeminiOCR] Model unavailable, trying next", {
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
