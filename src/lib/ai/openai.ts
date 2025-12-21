// src/lib/ai/openai.ts
import "server-only";

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
    const t = setTimeout(() => reject(new Error(`OPENAI_TIMEOUT_${ms}MS`)), ms);
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

async function openaiChatJson(args: {
  model: string;
  system: string;
  user: string;
  // A "shape hint" (example object) to keep structure stable.
  jsonSchemaHint: string;
}) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        {
          role: "user",
          content:
            `${args.user}\n\n` +
            `Return ONLY valid JSON. No markdown. No backticks.\n` +
            `Match this JSON shape example exactly (keys + nesting). Use null when unknown:\n` +
            `${args.jsonSchemaHint}`,
        },
      ],
    }),
  });

  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const msg =
      (json && (json.error?.message || json.error)) ||
      `openai_error_status_${r.status}`;
    throw new Error(msg);
  }

  const outputText =
    (json?.choices?.[0]?.message?.content as string) || "";

  return { raw: json, text: String(outputText || "") };
}

async function repairToJson(args: {
  model: string;
  system: string;
  badText: string;
  jsonSchemaHint: string;
}) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        {
          role: "user",
          content:
            `The following text was supposed to be JSON but is invalid.\n` +
            `Fix it into STRICT valid JSON ONLY (no markdown), matching this example shape:\n` +
            `${args.jsonSchemaHint}\n\n` +
            `BAD_TEXT:\n${args.badText}`,
        },
      ],
    }),
  });

  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const msg =
      (json && (json.error?.message || json.error)) ||
      `openai_repair_error_status_${r.status}`;
    throw new Error(msg);
  }

  const outputText =
    (json?.choices?.[0]?.message?.content as string) || "";

  return String(outputText || "");
}

/**
 * Canonical AI JSON call used across Buddy engines.
 * - Works without OpenAI key (returns schema-shaped fallback, requires review)
 * - With key: calls OpenAI Chat Completions API with JSON mode
 * - Parses + retries + repairs invalid JSON
 */
export async function aiJson<T = Json>(args: {
  scope: string;
  action: string;
  system: string;
  user: string;
  jsonSchemaHint: string;
}): Promise<AiJsonResult<T>> {
  try {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const timeoutMs = envInt("OPENAI_TIMEOUT_MS", 20000);
    const maxRetries = envInt("OPENAI_MAX_RETRIES", 2);

    // Deterministic fallback if key missing (keeps builds safe)
    if (!process.env.OPENAI_API_KEY) {
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
            note: "OPENAI_API_KEY missing; returned fallback schema-shaped object.",
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
        openaiChatJson({
          model,
          system: args.system,
          user: args.user,
          jsonSchemaHint: args.jsonSchemaHint,
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
            model,
            system: args.system,
            badText: resp.text.slice(0, 12000),
            jsonSchemaHint: args.jsonSchemaHint,
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
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "AI_ERROR",
    };
  }
}
