import type { NextApiRequest, NextApiResponse } from "next";

import { readFileSync, existsSync } from "node:fs";
import { normalizeGoogleError } from "@/lib/google/errors";
import { ensureGcpAdcBootstrap, runVertexAdcSmokeTest } from "@/lib/gcpAdcBootstrap";
import { getGcsBucketName, getGcsClient } from "@/lib/storage/gcs";
import { requireBuilderTokenApi } from "@/lib/builder/requireBuilderTokenApi";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

function resolveAdcType(path: string | null): string | null {
  if (!path) return null;
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.type === "string" ? parsed.type : null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (!(await requireBuilderTokenApi(req, res))) {
    return;
  }

  const errors: Array<{ code: string; message: string }> = [];

  let adcOk = false;
  let adcType: string | null = null;
  try {
    ensureGcpAdcBootstrap();
    const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? null;
    adcType = resolveAdcType(adcPath);
    adcOk = Boolean(adcPath && adcType);
    if (!adcOk) {
      errors.push({ code: "GOOGLE_AUTH_FAILED", message: "ADC credentials missing" });
    }
  } catch (e: any) {
    const normalized = normalizeGoogleError(e);
    errors.push({ code: normalized.code, message: normalized.message });
  }

  let gcsOk = false;
  try {
    const bucket = getGcsBucketName();
    const client = await getGcsClient();
    await withTimeout(client.bucket(bucket).getMetadata(), 4000, "gcs_metadata");
    gcsOk = true;
  } catch (e: any) {
    const normalized = normalizeGoogleError(e);
    errors.push({ code: normalized.code, message: normalized.message });
  }

  let vertexOk = false;
  if (String(process.env.USE_GEMINI_OCR || "").toLowerCase() !== "true") {
    errors.push({ code: "VERTEX_DISABLED", message: "Gemini OCR disabled" });
  } else {
    try {
      await withTimeout(runVertexAdcSmokeTest(), 6000, "vertex_smoke");
      vertexOk = true;
    } catch (e: any) {
      const normalized = normalizeGoogleError(e);
      errors.push({ code: normalized.code, message: normalized.message });
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    auth: true,
    adc: { ok: adcOk, type: adcType },
    gcs: { ok: gcsOk },
    vertex: { ok: vertexOk },
    errors,
  });
}
