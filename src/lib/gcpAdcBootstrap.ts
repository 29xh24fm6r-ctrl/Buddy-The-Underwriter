import "server-only";

import fs from "node:fs";
import type { GoogleAuthOptions } from "google-auth-library";
import { getVercelOidcToken } from "@/lib/google/getVercelOidcToken";
import { getVercelWifAuthClient } from "@/lib/gcp/vercelAuth";
import { GEMINI_FLASH } from "@/lib/ai/models";
import { getVertexLocation } from "@/lib/ai/vertexLocation";
import { resolveAudience, resolveServiceAccountEmail } from "@/lib/gcp/wif";

const WIF_CREDENTIALS_PATH = "/tmp/gcp-wif.json";
export function getProjectId(): string | null {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCS_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    null
  );
}

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

export async function getVertexAuthOptions(): Promise<GoogleAuthOptions | undefined> {
  if (!isVercelRuntime()) return undefined;
  const authClient = await getVercelWifAuthClient();
  return { authClient };
}

async function resolveSubjectToken(): Promise<string | null> {
  // GCP_WIF_SUBJECT_TOKEN is a manually-set subject token for ADC bootstrap
  const manualToken = process.env.GCP_WIF_SUBJECT_TOKEN;
  if (manualToken) return manualToken;

  // Delegate to unified OIDC resolver (handles @vercel/oidc, env vars)
  return await getVercelOidcToken();
}

async function buildWifConfig(): Promise<Record<string, any> | null> {
  const subjectToken = await resolveSubjectToken();
  if (!subjectToken) return null;

  try {
    const audience = resolveAudience();
    const serviceAccountEmail = resolveServiceAccountEmail();

    return {
      type: "external_account",
      audience,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url:
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
      credential_source: {
        environment_id: "vercel",
        subject_token: subjectToken,
      },
    };
  } catch {
    return null;
  }
}

export async function ensureGcpAdcBootstrap(): Promise<void> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;

  const config = await buildWifConfig();
  if (!config) return;

  const nextContents = JSON.stringify(config);
  let shouldWrite = true;

  try {
    const current = fs.readFileSync(WIF_CREDENTIALS_PATH, "utf8");
    if (current.trim() === nextContents.trim()) {
      shouldWrite = false;
    }
  } catch {
    shouldWrite = true;
  }

  if (shouldWrite) {
    fs.writeFileSync(WIF_CREDENTIALS_PATH, nextContents, { encoding: "utf8", mode: 0o600 });
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = WIF_CREDENTIALS_PATH;

  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    const projectId = getProjectId();
    if (projectId) {
      process.env.GOOGLE_CLOUD_PROJECT = projectId;
    }
  }
}

/**
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §1 — mints a bearer access token for
 * a raw, SDK-free authenticated fetch() against a Vertex REST endpoint
 * (Gateway Invariant #3: no @google/genai or @google-cloud/vertexai import
 * inside src/lib/ai/providers/). Reuses the same WIF auth client every
 * other Vertex-calling file in this repo already goes through
 * (getVertexAuthOptions() above) rather than re-deriving auth.
 *
 * On Vercel, getVertexAuthOptions() returns a WIF-backed authClient. Off
 * Vercel (local/CI), it returns undefined, so this falls back to
 * google-auth-library's standard ADC resolution (GOOGLE_APPLICATION_CREDENTIALS,
 * gcloud default credentials, etc.) — same two-path shape
 * ensureGcpAdcBootstrap() already establishes for the rest of this file.
 */
// Test-only seam for the WIF-authClient branch — the no-authClient fallback
// below delegates entirely to google-auth-library's own ADC resolution
// (file/metadata-server probing), which this repo doesn't unit-test any
// more than it unit-tests other third-party SDK internals elsewhere.
let getVertexAuthOptionsImpl: () => Promise<GoogleAuthOptions | undefined> = getVertexAuthOptions;

export function __setVertexAuthOptionsForTests(
  impl: () => Promise<GoogleAuthOptions | undefined>,
): void {
  getVertexAuthOptionsImpl = impl;
}

export function __resetVertexAuthOptionsForTests(): void {
  getVertexAuthOptionsImpl = getVertexAuthOptions;
}

export async function getVertexAccessToken(): Promise<string> {
  await ensureGcpAdcBootstrap();

  const authOptions = await getVertexAuthOptionsImpl();
  if (authOptions?.authClient) {
    const tokenResponse = await authOptions.authClient.getAccessToken();
    const token =
      typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
    if (!token) throw new Error("getVertexAccessToken: WIF authClient returned no token");
    return token;
  }

  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) throw new Error("getVertexAccessToken: default ADC returned no token");
  return token;
}

export async function runVertexAdcSmokeTest(): Promise<{ ok: true; model: string }> {
  if (process.env.NODE_ENV === "production" && process.env.GCP_ADC_SMOKE_TEST !== "true") {
    throw new Error("gcp_adc_smoke_disabled");
  }

  await ensureGcpAdcBootstrap();

  // SPEC-VERTEX-SDK-MIGRATION-1: dynamic import of new SDK
  const { GoogleGenAI } = await import("@google/genai");
  const project = getProjectId();
  if (!project) {
    throw new Error("Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT or GCS_PROJECT_ID.");
  }

  const location = getVertexLocation();
  const model = process.env.GEMINI_MODEL || GEMINI_FLASH;

  const googleAuthOptions = await getVertexAuthOptions();
  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    ...(googleAuthOptions ? { googleAuthOptions: googleAuthOptions as any } : {}),
  });

  // No temperature override; default is fine for a smoke test. Gemini 3.x
  // rejects sub-1.0 temperatures anyway.
  await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: "OK" }] }],
  });

  return { ok: true, model };
}
