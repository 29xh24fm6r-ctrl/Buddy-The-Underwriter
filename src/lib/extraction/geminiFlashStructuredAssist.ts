import "server-only";

import { VertexAI } from "@google-cloud/vertexai";
import { ensureGcpAdcBootstrap, getVertexAuthOptions } from "@/lib/gcpAdcBootstrap";
import { buildStructuredAssistPrompt } from "./geminiFlashPrompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structured assist result — matches the entity/formField shape consumed by
 * structuredJsonParser.ts (formerly docAiParser.ts).
 *
 * This is ADVISORY data only. It feeds into deterministic extractors as an
 * assist layer. It never persists facts directly, never alters classification,
 * never influences slot binding.
 */
export type StructuredAssistResult = {
  entities: Array<{
    type: string;
    mentionText: string;
    confidence: number;
    normalizedValue?: {
      text?: string;
      moneyValue?: { units: number; nanos: number };
    };
  }>;
  formFields: Array<{
    name: string;
    value: string;
    confidence: number;
  }>;
  text: string;
  _meta: {
    model: string;
    latencyMs: number;
    source: "gemini_flash_structured_assist";
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRUCTURED_ASSIST_TIMEOUT_MS = 30_000; // 30s hard timeout
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_TEMPERATURE = 0.1;
const MAX_OCR_TEXT_LENGTH = 50_000; // Truncate to avoid token limits

// ---------------------------------------------------------------------------
// GCP helpers (reuse from Gemini OCR patterns)
// ---------------------------------------------------------------------------

function getGoogleProjectId(): string {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCS_PROJECT_ID ||
    process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT.",
    );
  }
  return projectId;
}

function getGoogleLocation(): string {
  return (
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_CLOUD_REGION ||
    "us-central1"
  );
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Call Gemini Flash to extract structured financial data from OCR text.
 *
 * ADVISORY ONLY — this function:
 * - Does NOT write to DB
 * - Does NOT emit facts
 * - Does NOT change classification
 * - Does NOT bind slots
 *
 * Returns null on any failure (timeout, invalid JSON, unsupported type).
 * Never throws — fail-fast, fail-closed, no pipeline block.
 */
export async function extractStructuredAssist(args: {
  ocrText: string;
  canonicalType: string;
  documentId: string;
}): Promise<StructuredAssistResult | null> {
  const started = Date.now();

  try {
    // Build type-specific prompt
    const truncatedText = args.ocrText.slice(0, MAX_OCR_TEXT_LENGTH);
    const prompt = buildStructuredAssistPrompt(args.canonicalType, truncatedText);
    if (!prompt) {
      // Unsupported type — deterministic extractors handle via OCR regex
      return null;
    }

    await ensureGcpAdcBootstrap();
    const googleAuthOptions = await getVertexAuthOptions();
    const vertexAI = new VertexAI({
      project: getGoogleProjectId(),
      location: getGoogleLocation(),
      ...(googleAuthOptions ? { googleAuthOptions: googleAuthOptions as any } : {}),
    });

    const model = vertexAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        temperature: GEMINI_TEMPERATURE,
        responseMimeType: "application/json",
      },
    });

    const generatePromise = model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt.userPrompt }],
        },
      ],
      systemInstruction: {
        role: "system",
        parts: [{ text: prompt.systemInstruction }],
      },
    });

    // Enforce hard timeout
    const resp = await Promise.race([
      generatePromise,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error(`structured_assist_timeout_${STRUCTURED_ASSIST_TIMEOUT_MS}ms`)),
          STRUCTURED_ASSIST_TIMEOUT_MS,
        ),
      ),
    ]);

    // Extract response text
    const parts = (resp as any)?.response?.candidates?.[0]?.content?.parts ?? [];
    const rawText = parts
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();

    if (!rawText) {
      console.warn("[StructuredAssist] Empty response from Gemini Flash", {
        documentId: args.documentId,
        canonicalType: args.canonicalType,
      });
      return null;
    }

    // Parse JSON — reject if not valid
    const parsed = parseJsonSafe(rawText);
    if (!parsed) {
      console.warn("[StructuredAssist] Invalid JSON from Gemini Flash", {
        documentId: args.documentId,
        canonicalType: args.canonicalType,
        rawLength: rawText.length,
      });
      return null;
    }

    // Validate expected shape
    const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
    const formFields = Array.isArray(parsed.formFields) ? parsed.formFields : [];

    const latencyMs = Date.now() - started;

    console.log("[StructuredAssist] Extraction completed", {
      documentId: args.documentId,
      canonicalType: args.canonicalType,
      entityCount: entities.length,
      formFieldCount: formFields.length,
      latencyMs,
    });

    return {
      // Wrap in a structure that mirrors the DocAI response shape
      // so structuredJsonParser.ts can consume it unchanged
      entities: entities.filter(isValidEntity),
      formFields: formFields.filter(isValidFormField),
      text: truncatedText,
      _meta: {
        model: GEMINI_MODEL,
        latencyMs,
        source: "gemini_flash_structured_assist",
      },
    };
  } catch (err: any) {
    const latencyMs = Date.now() - started;
    console.warn("[StructuredAssist] Failed — deterministic extractors will use OCR regex", {
      documentId: args.documentId,
      canonicalType: args.canonicalType,
      error: err?.message || String(err),
      latencyMs,
    });
    // Never throw — return null so deterministic extractors fall back to OCR regex
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonSafe(text: string): any | null {
  try {
    // Strip markdown code fences if present (defensive)
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isValidEntity(e: any): boolean {
  return (
    e &&
    typeof e === "object" &&
    typeof e.type === "string" &&
    e.type.length > 0
  );
}

function isValidFormField(f: any): boolean {
  return (
    f &&
    typeof f === "object" &&
    typeof f.name === "string" &&
    f.name.length > 0
  );
}
