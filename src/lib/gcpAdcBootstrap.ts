import "server-only";

import fs from "node:fs";
import type { GoogleAuthOptions } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";
import { getVercelWifAuthClient } from "@/lib/gcp/vercelAuth";
import { resolveAudience, resolveServiceAccountEmail } from "@/lib/gcp/wif";

const WIF_CREDENTIALS_PATH = "/tmp/gcp-wif.json";
function getProjectId(): string | null {
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
  const envToken = process.env.GCP_WIF_SUBJECT_TOKEN || process.env.VERCEL_OIDC_TOKEN;
  if (envToken) return envToken;
  if (!isVercelRuntime()) return null;
  try {
    return await getVercelOidcToken();
  } catch {
    return null;
  }
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

export async function runVertexAdcSmokeTest(): Promise<{ ok: true; model: string }> {
  if (process.env.NODE_ENV === "production" && process.env.GCP_ADC_SMOKE_TEST !== "true") {
    throw new Error("gcp_adc_smoke_disabled");
  }

  await ensureGcpAdcBootstrap();

  const { VertexAI } = await import("@google-cloud/vertexai");
  const project = getProjectId();
  if (!project) {
    throw new Error("Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT or GCS_PROJECT_ID.");
  }

  const location =
    process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_REGION || "us-central1";
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  const googleAuthOptions = await getVertexAuthOptions();
  const vertex = new VertexAI({
    project,
    location,
    ...(googleAuthOptions ? { googleAuthOptions: googleAuthOptions as any } : {}),
  });
  const gen = vertex.getGenerativeModel({ model });

  await gen.generateContent({
    contents: [{ role: "user", parts: [{ text: "OK" }] }],
    generationConfig: { temperature: 0 },
  });

  return { ok: true, model };
}
