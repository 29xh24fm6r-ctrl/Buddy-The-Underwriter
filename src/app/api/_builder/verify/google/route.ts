import "server-only";

import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";
import { normalizeGoogleError } from "@/lib/google/errors";
import { ensureGcpAdcBootstrap, runVertexAdcSmokeTest } from "@/lib/gcpAdcBootstrap";
import { getGcsBucketName, getGcsClient } from "@/lib/storage/gcs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const buildResponse = (status: number, payload: Record<string, unknown>) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

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

export async function GET(req: Request) {
  mustBuilderToken(req);

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

  return buildResponse(200, {
    ok: true,
    auth: true,
    adc: { ok: adcOk, type: adcType },
    gcs: { ok: gcsOk },
    vertex: { ok: vertexOk },
    errors,
  });
}
