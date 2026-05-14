// src/buddy/brain/geminiAdapter.ts
import "server-only";

import type { BuddyContextPack } from "@/buddy/brain/types";
import { GoogleGenAI } from "@google/genai";
import { ensureGcpAdcBootstrap, getVertexAuthOptions } from "@/lib/gcpAdcBootstrap";
import { GEMINI_FLASH } from "@/lib/ai/models";
import { getVertexLocation } from "@/lib/ai/vertexLocation";
import { classifySdkError } from "@/lib/extraction/sdkResponseGuard";

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

export async function geminiShadowAnalyze(ctx: BuddyContextPack) {
  const model = process.env.GEMINI_MODEL ?? GEMINI_FLASH;
  await ensureGcpAdcBootstrap();
  const googleAuthOptions = await getVertexAuthOptions();
  // SPEC-VERTEX-SDK-MIGRATION-1: @google/genai with vertexai:true
  const ai = new GoogleGenAI({
    vertexai: true,
    project: getGoogleProjectId(),
    location: getVertexLocation(),
    ...(googleAuthOptions ? { googleAuthOptions: googleAuthOptions as any } : {}),
  });

  const prompt = [
    "You are Buddy Shadow Brain. Return STRICT JSON only. No markdown.",
    "Task: derive structured subcontext to help a voice assistant without blocking.",
    "Rules:",
    "- Do not invent facts. Use only ctx fields.",
    "- Output must be valid JSON object with keys: intent, missing, notes, confidence.",
    "",
    `ctx=${JSON.stringify(ctx)}`,
  ].join("\n");

  const started = Date.now();
  const timeoutMs = 10_000;

  try {
    // SPEC-VERTEX-SDK-MIGRATION-1: ai.models.generateContent unified call
    const res = (await Promise.race([
      ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.2 },
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("gemini_timeout")), timeoutMs),
      ),
    ])) as any;

    const latencyMs = Date.now() - started;
    // SPEC-VERTEX-SDK-MIGRATION-1: response shape (no `.response` wrapper)
    const text =
      (res as any)?.text ??
      (res as any)?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "";
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { intent: "unknown", missing: null, notes: "non-json response", confidence: 0.1 };
    }

    return { model, latencyMs, resultJson: parsed };
  } catch (err: unknown) {
    const latencyMs = Date.now() - started;
    const classification = classifySdkError(err);
    if (classification.isHtmlResponse) {
      console.error("[geminiShadowAnalyze] SDK_HTML_RESPONSE", {
        model,
        rawSnippet: classification.rawSnippet,
        latencyMs,
      });
    }
    return {
      model,
      latencyMs,
      resultJson: { intent: "unknown", missing: null, notes: "error", confidence: 0 },
    };
  }
}
