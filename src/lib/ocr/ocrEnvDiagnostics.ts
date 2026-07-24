import "server-only";
import { MISTRAL_OCR } from "@/lib/ai/models";

export type OcrEnvDiagnostics = {
  useGeminiOcrEnabled: boolean;
  hasGoogleProject: boolean;
  hasGoogleCredentialsHint: boolean;
  googleLocation: string | null;
  geminiModel: string | null;
  /** Whether the Mistral fallback (used when Gemini OCR fails/is disabled) is configured. */
  mistralFallbackConfigured: boolean;
  mistralModel: string;
};

export function getOcrEnvDiagnostics(): OcrEnvDiagnostics {
  const useGeminiOcrEnabled = process.env.USE_GEMINI_OCR === "true";

  const hasGoogleProject = Boolean(
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID,
  );

  // Mirrors the credential sources supported by `runGeminiOcrJob`.
  const hasWifProvider = Boolean(process.env.GCP_WIF_PROVIDER);
  const hasWifSplit = Boolean(
    process.env.GCP_PROJECT_NUMBER &&
      process.env.GCP_WORKLOAD_IDENTITY_POOL_ID &&
      process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
  );
  const hasGoogleCredentialsHint = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      (process.env.GCP_SERVICE_ACCOUNT_EMAIL && (hasWifProvider || hasWifSplit)),
  );

  const googleLocation =
    process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_REGION || null;

  const geminiModel =
    process.env.GEMINI_OCR_MODEL || process.env.GEMINI_MODEL || null;

  const mistralFallbackConfigured = Boolean(process.env.MISTRAL_API_KEY);

  return {
    useGeminiOcrEnabled,
    hasGoogleProject,
    hasGoogleCredentialsHint,
    googleLocation,
    geminiModel,
    mistralFallbackConfigured,
    mistralModel: MISTRAL_OCR,
  };
}
