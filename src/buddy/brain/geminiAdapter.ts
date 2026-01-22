// src/buddy/brain/geminiAdapter.ts
import "server-only";

import type { BuddyContextPack } from "@/buddy/brain/types";
import { VertexAI } from "@google-cloud/vertexai";
import { ensureGcpAdcBootstrap } from "@/lib/gcpAdcBootstrap";

function getGoogleProjectId(): string {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCS_PROJECT_ID ||
    process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT (recommended) or GCS_PROJECT_ID.",
    );
  }
  return projectId;
}

function getGoogleLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_REGION || "us-central1";
}

export async function geminiShadowAnalyze(ctx: BuddyContextPack) {
  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  await ensureGcpAdcBootstrap();
  const vertex = new VertexAI({
    project: getGoogleProjectId(),
    location: getGoogleLocation(),
  });
  const gemini = vertex.getGenerativeModel({ model });

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
  const timeoutMs = 10_000;

  try {
    const latencyMs = Date.now() - started;
    const res = (await Promise.race([
      gemini.generateContent({
        contents: body.contents,
        generationConfig: body.generationConfig,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("gemini_timeout")), timeoutMs),
      ),
    ])) as any;

    const text = (res as any)?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { intent: "unknown", missing: null, notes: "non-json response", confidence: 0.1 };
    }

    return { model, latencyMs, resultJson: parsed };
  } finally {
    // no-op
  }
}
