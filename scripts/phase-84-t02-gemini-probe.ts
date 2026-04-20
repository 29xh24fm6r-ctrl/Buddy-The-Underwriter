#!/usr/bin/env tsx
/**
 * Phase 84 T-02 probe — tests the exact REST endpoint + model the classifier uses.
 *
 * Usage from repo root:
 *   npx tsx scripts/phase-84-t02-gemini-probe.ts
 *
 * Requires GEMINI_API_KEY in environment or .env (dotenv is loaded).
 *
 * Reports:
 *   1. LIST MODELS — does the REST endpoint serve gemini-3-flash-preview?
 *   2. Probe WITH temperature: 0.0 (current classifier behavior)
 *   3. Probe WITHOUT temperature (per isGemini3Model guidance)
 */
import "dotenv/config";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3-flash-preview"; // matches MODEL_CLASSIFICATION in src/lib/ai/models.ts

if (!API_KEY) {
  console.error("GEMINI_API_KEY missing from env / .env");
  process.exit(1);
}

async function listModels() {
  console.log("═══ LIST MODELS (first 200 chars of body if error) ═══");
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}&pageSize=100`,
  );
  console.log(`HTTP status: ${resp.status} ${resp.statusText}`);
  if (!resp.ok) {
    const body = await resp.text();
    console.log(`Body: ${body.slice(0, 500)}`);
    return;
  }
  const json = await resp.json();
  const names: string[] = (json.models ?? []).map((m: any) => m.name);
  const served = names.includes(`models/${MODEL}`);
  console.log(`Looking for: models/${MODEL}`);
  console.log(`Served by this endpoint? ${served ? "YES" : "NO"}`);
  console.log(`\nAll models containing 'flash':`);
  names.filter((n) => n.includes("flash")).forEach((n) => console.log(`  ${n}`));
  console.log(`\nAll models containing 'gemini-3':`);
  names.filter((n) => n.includes("gemini-3")).forEach((n) => console.log(`  ${n}`));
}

async function probe(useTemperature: boolean, label: string) {
  console.log(`\n═══ ${label} ═══`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const body: any = {
    contents: [
      {
        role: "user",
        parts: [{ text: 'Return ONLY the JSON: {"test": true, "doc_type": "UNKNOWN"}' }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 512,
    },
  };
  if (useTemperature) body.generationConfig.temperature = 0.0;

  const start = Date.now();
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - start;

  console.log(`HTTP status: ${resp.status} ${resp.statusText} (${latency}ms)`);
  const text = await resp.text();
  console.log(`Body (first 800 chars):\n${text.slice(0, 800)}`);

  if (resp.ok) {
    try {
      const json = JSON.parse(text);
      const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
      const finishReason = json.candidates?.[0]?.finishReason;
      console.log(`\nfinishReason: ${finishReason}`);
      console.log(`content: ${content?.slice(0, 300)}`);
      if (content) {
        try {
          const parsed = JSON.parse(content);
          console.log(`\n✅ Parsed successfully:`, parsed);
        } catch (e: any) {
          console.log(`\n❌ Content failed JSON.parse: ${e.message}`);
        }
      }
    } catch {
      /* body already printed */
    }
  }
}

async function main() {
  await listModels();
  await probe(true, "PROBE 1 — WITH temperature: 0.0 (current classifier behavior)");
  await probe(false, "PROBE 2 — WITHOUT temperature (per isGemini3Model guidance)");
}

main().catch((e) => {
  console.error("Probe failed:", e);
  process.exit(1);
});
