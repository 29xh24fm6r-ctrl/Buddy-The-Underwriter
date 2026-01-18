// src/buddy/brain/geminiAdapter.ts
import "server-only";

import type { BuddyContextPack } from "@/buddy/brain/types";

export async function geminiShadowAnalyze(ctx: BuddyContextPack) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = [
    "You are Buddy Shadow Brain. Return STRICT JSON only. No markdown.",
    "Task: derive structured subcontext to help a voice assistant without blocking.",
    "Rules:",
    "- Do not invent facts. Use only ctx fields.",
    "- Output must be valid JSON object with keys: intent, missing, notes, confidence.",
    "",
    `ctx=${JSON.stringify(ctx)}`,
  ].join("\n");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2 },
  };

  const started = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
    }

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { intent: "unknown", missing: null, notes: "non-json response", confidence: 0.1 };
    }

    return { model, latencyMs, resultJson: parsed };
  } finally {
    clearTimeout(t);
  }
}
