/**
 * Gemini REST client for the FDD extractor — adapted from
 * src/lib/ai/geminiClient.ts but with PDF inlineData support.
 *
 * Model selection mirrors src/lib/ai/models.ts MODEL_EXTRACTION (currently
 * GEMINI_FLASH = "gemini-3-flash-preview"). If that model is rejected by
 * the REST endpoint with HTTP 404 or 400 (model not found / unsupported),
 * automatically retry with the documented fallback "gemini-2.5-flash" and
 * log which model actually answered. This exists because the `gemini-3-*`
 * preview slot has historically rotated availability — production paths
 * need to keep working without a code change.
 *
 * Update `PRIMARY_MODEL` here in lockstep with the registry value.
 */

const PRIMARY_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODEL = 'gemini-2.5-flash';

const DEFAULT_TIMEOUT_MS = 60_000; // PDF extraction is slower than text-only
const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiPdfPart {
  inlineData: { mimeType: string; data: string };
}

export interface CallGeminiOpts {
  prompt: string;
  pdfBase64?: string;       // optional — when present, sent as inlineData
  systemInstruction?: string;
  logTag: string;
  timeoutMs?: number;
}

export interface CallGeminiResult<T> {
  ok: boolean;
  result: T | null;
  modelUsed: string;
  attempts: number;
  latencyMs: number;
  error?: string;
}

/** Track which model the worker last successfully used in this process —
 *  if PRIMARY repeatedly 404s we want to skip it and start with FALLBACK
 *  to save round-trips. Resets on every cold start. */
let preferredModel: string = PRIMARY_MODEL;

export async function callGeminiForExtraction<T>(
  opts: CallGeminiOpts
): Promise<CallGeminiResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      result: null,
      modelUsed: '',
      attempts: 0,
      latencyMs: 0,
      error: 'GEMINI_API_KEY missing',
    };
  }

  const start = Date.now();
  const order = preferredModel === PRIMARY_MODEL
    ? [PRIMARY_MODEL, FALLBACK_MODEL]
    : [FALLBACK_MODEL, PRIMARY_MODEL];

  let lastError = '';
  let attempts = 0;

  for (const model of order) {
    attempts++;
    try {
      const result = await callOnce<T>({ apiKey, model, ...opts });
      if (model !== preferredModel) {
        console.log(
          `[gemini:${opts.logTag}] preferred model now ${model} (was ${preferredModel})`
        );
        preferredModel = model;
      }
      return {
        ok: true,
        result,
        modelUsed: model,
        attempts,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const isModelMissing =
        /HTTP 404/.test(lastError) ||
        /HTTP 400/.test(lastError) ||
        /not found/i.test(lastError) ||
        /unsupported/i.test(lastError) ||
        /not supported/i.test(lastError);
      if (!isModelMissing) {
        // Real error (timeout, 5xx, parse) — don't fall back, that won't help.
        break;
      }
      console.warn(
        `[gemini:${opts.logTag}] model ${model} unavailable (${lastError.slice(0, 80)}); trying fallback`
      );
    }
  }

  return {
    ok: false,
    result: null,
    modelUsed: '',
    attempts,
    latencyMs: Date.now() - start,
    error: lastError,
  };
}

async function callOnce<T>(args: {
  apiKey: string;
  model: string;
  prompt: string;
  pdfBase64?: string;
  systemInstruction?: string;
  logTag: string;
  timeoutMs?: number;
}): Promise<T> {
  const url = `${ENDPOINT_BASE}/${args.model}:generateContent?key=${args.apiKey}`;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const parts: Array<{ text: string } | GeminiPdfPart> = [];
  if (args.pdfBase64) {
    parts.push({
      inlineData: { mimeType: 'application/pdf', data: args.pdfBase64 },
    });
  }
  parts.push({ text: args.prompt });

  // Gemini 3.x rejects sub-1.0 temperatures; omit entirely. The fallback
  // (2.5-flash) accepts the omission too — safe for both.
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json' },
  };
  if (args.systemInstruction) {
    body.systemInstruction = { parts: [{ text: args.systemInstruction }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) throw new Error('empty response');

  // Gemini occasionally wraps JSON in ```json fences even with responseMimeType.
  const clean = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  return JSON.parse(clean) as T;
}
