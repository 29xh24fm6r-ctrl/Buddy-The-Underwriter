// Migrated to Gemini — filename retained for import stability
// src/lib/ai/openai.ts
import { assertServerOnly } from "@/lib/serverOnly";

assertServerOnly();

type Json = any;

export type AiJsonResult<T = Json> =
  | {
      ok: true;
      result: T;
      confidence: number; // 0-100 (system-level, not model logprobs)
      evidence?: any[];
      requires_human_review: boolean;
      rawText?: string;
      model?: string;
    }
  | {
      ok: false;
      error: string;
      rawText?: string;
      model?: string;
    };

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function envInt(name: string, fallback: number) {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function withTimeout<T>(p: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`AI_TIMEOUT_${ms}MS`)), ms);
    p.then((x) => {
      clearTimeout(t);
      resolve(x);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function extractFirstJsonObject(text: string): string | null {
  // Finds the first balanced {...} object in a string.
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return null;
}

// Phase 93: model strings are centralised in src/lib/ai/models.ts.
import { GEMINI_FLASH, isGemini3Model } from "./models";
const GEMINI_MODEL = GEMINI_FLASH;

function geminiUrl(apiKey: string, model: string = GEMINI_MODEL) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

/**
 * Gemini 3.x models (3-flash, 3.1-pro) warn that temperatures below 1.0
 * cause looping and degraded output. Google's published guidance is to
 * omit temperature entirely for gemini-3.* so the model uses its default.
 * For prior families (1.5, 2.0, 2.5) we keep the explicit low-temperature
 * behaviour the app relies on for deterministic JSON output.
 *
 * The Gemini-3 family check lives in src/lib/ai/models.ts so call sites
 * never need to hardcode a model-prefix string (CI gate-safe).
 */
function buildGenerationConfig(args: {
  model: string;
  temperature: number;
  maxOutputTokens: number;
}): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    responseMimeType: "application/json",
    maxOutputTokens: args.maxOutputTokens,
  };
  if (!isGemini3Model(args.model)) {
    cfg.temperature = args.temperature;
  }
  return cfg;
}

/**
 * Extract text from a Gemini generateContent response.
 * Filters out parts where `thought === true` (thinking-mode reasoning traces)
 * and concatenates the remaining text parts. Safe for models with thinking
 * enabled (gemini-2.5-pro-preview) AND disabled (gemini-3-flash-preview).
 */
function extractResponseText(json: any): string {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return "";
  const joined = parts
    .filter((p: { thought?: boolean }) => !p?.thought)
    .map((p: { text?: string }) => p?.text ?? "")
    .join("");
  return joined;
}

async function geminiChatJson(args: {
  system: string;
  user: string;
  jsonSchemaHint: string;
  model?: string;
  maxOutputTokens?: number;
}) {
  const model = args.model ?? GEMINI_MODEL;
  const r = await fetch(geminiUrl(process.env.GEMINI_API_KEY!, model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          text:
            `${args.system}\n\n` +
            `${args.user}\n\n` +
            `Return ONLY valid JSON. No markdown. No backticks.\n` +
            `Match this JSON shape example exactly (keys + nesting). Use null when unknown:\n` +
            `${args.jsonSchemaHint}`,
        }],
      }],
      generationConfig: buildGenerationConfig({
        model,
        temperature: 0.1,
        maxOutputTokens: args.maxOutputTokens ?? 4096,
      }),
    }),
  });

  const json = await r.json().catch(() => null);
  if (!r.ok) {
    // Phase 92 diagnostic: surface the raw Gemini error body to Vercel logs
    // so we can see the actual HTTP status and Google error payload when a
    // call fails (quota, key, region, safety filter, invalid model, etc.).
    console.error(
      "[geminiChatJson] status:", r.status,
      "body:", JSON.stringify(json)?.slice(0, 500),
    );
    const msg = json?.error?.message || `gemini_error_status_${r.status}`;
    throw new Error(msg);
  }

  return { raw: json, text: extractResponseText(json) };
}

async function repairToJson(args: {
  system: string;
  badText: string;
  jsonSchemaHint: string;
  model?: string;
  maxOutputTokens?: number;
}) {
  const model = args.model ?? GEMINI_MODEL;
  const r = await fetch(geminiUrl(process.env.GEMINI_API_KEY!, model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          text:
            `${args.system}\n\n` +
            `The following text was supposed to be JSON but is invalid.\n` +
            `Fix it into STRICT valid JSON ONLY (no markdown), matching this example shape:\n` +
            `${args.jsonSchemaHint}\n\n` +
            `BAD_TEXT:\n${args.badText}`,
        }],
      }],
      generationConfig: buildGenerationConfig({
        model,
        temperature: 0,
        maxOutputTokens: args.maxOutputTokens ?? 4096,
      }),
    }),
  });

  const json = await r.json().catch(() => null);
  if (!r.ok) {
    console.error(
      "[repairToJson] status:", r.status,
      "body:", JSON.stringify(json)?.slice(0, 500),
    );
    const msg = json?.error?.message || `gemini_repair_error_status_${r.status}`;
    throw new Error(msg);
  }

  return extractResponseText(json);
}

/**
 * Canonical AI JSON call used across Buddy engines.
 * - Works without GEMINI_API_KEY (returns schema-shaped fallback, requires review)
 * - With key: calls Gemini with JSON mode
 * - Parses + retries + repairs invalid JSON
 */
export async function aiJson<T = Json>(args: {
  scope: string;
  action: string;
  system: string;
  user: string;
  jsonSchemaHint: string;
  /** Override the default Gemini flash model. E.g. use GEMINI_PRO from @/lib/ai/models for deep-reasoning tasks. */
  model?: string;
  /** Override default 4096 maxOutputTokens — useful for deep-reasoning models that may emit thought traces. */
  maxOutputTokens?: number;
  /** Override per-request HTTP timeout (ms). Default = env AI_TIMEOUT_MS or 20_000.
   *  Set higher than the AI_TIMEOUT_MS default for Pro / thinking-mode calls that can
   *  take 30-60s. Keep the override strictly below the Vercel route's maxDuration. */
  timeoutMs?: number;
}): Promise<AiJsonResult<T>> {
  try {
    const model = args.model ?? GEMINI_MODEL;
    const timeoutMs = args.timeoutMs ?? envInt("AI_TIMEOUT_MS", 20000);
    const maxRetries = envInt("AI_MAX_RETRIES", 2);

    // Deterministic fallback if key missing (keeps builds safe)
    if (!process.env.GEMINI_API_KEY) {
      const shape = extractFirstJsonObject(args.jsonSchemaHint) || "{}";
      let fallback: any = {};
      try {
        fallback = JSON.parse(shape);
      } catch {
        fallback = {};
      }
      return {
        ok: true,
        result: fallback as T,
        confidence: 10,
        evidence: [
          {
            kind: "system_note",
            note: "GEMINI_API_KEY missing; returned fallback schema-shaped object.",
            scope: args.scope,
            action: args.action,
          },
        ],
        requires_human_review: true,
        model,
      };
    }

    let lastRawText = "";
    let attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;

      const resp = await withTimeout(
        geminiChatJson({
          system: args.system,
          user: args.user,
          jsonSchemaHint: args.jsonSchemaHint,
          model,
          maxOutputTokens: args.maxOutputTokens,
        }),
        timeoutMs
      );

      lastRawText = resp.text;

      // Try direct parse
      try {
        const parsed = JSON.parse(resp.text);

        const conf = clamp(Number(parsed?.confidence ?? 75));
        const requires =
          typeof parsed?.requires_human_review === "boolean"
            ? Boolean(parsed.requires_human_review)
            : conf < 85;

        return {
          ok: true,
          result: parsed as T,
          confidence: conf,
          evidence: parsed?.evidence ?? undefined,
          requires_human_review: requires,
          rawText: resp.text,
          model,
        };
      } catch {
        // Try extracting first JSON object from text
        const obj = extractFirstJsonObject(resp.text);
        if (obj) {
          try {
            const parsed = JSON.parse(obj);
            const conf = clamp(Number(parsed?.confidence ?? 70));
            const requires =
              typeof parsed?.requires_human_review === "boolean"
                ? Boolean(parsed.requires_human_review)
                : conf < 85;

            return {
              ok: true,
              result: parsed as T,
              confidence: conf,
              evidence: parsed?.evidence ?? undefined,
              requires_human_review: requires,
              rawText: resp.text,
              model,
            };
          } catch {
            // fall through to repair
          }
        }

        // Repair attempt (1x per loop)
        const repaired = await withTimeout(
          repairToJson({
            system: args.system,
            badText: resp.text.slice(0, 12000),
            jsonSchemaHint: args.jsonSchemaHint,
            model,
            maxOutputTokens: args.maxOutputTokens,
          }),
          timeoutMs
        );

        lastRawText = repaired;

        try {
          const parsed = JSON.parse(repaired);
          const conf = clamp(Number(parsed?.confidence ?? 65));
          const requires =
            typeof parsed?.requires_human_review === "boolean"
              ? Boolean(parsed.requires_human_review)
              : conf < 85;

          return {
            ok: true,
            result: parsed as T,
            confidence: conf,
            evidence: parsed?.evidence ?? undefined,
            requires_human_review: requires,
            rawText: repaired,
            model,
          };
        } catch {
          // retry loop
        }
      }
    }

    return {
      ok: false,
      error: "AI_JSON_PARSE_FAILED_AFTER_RETRIES",
      rawText: lastRawText,
      model,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "AI_ERROR",
    };
  }
}
