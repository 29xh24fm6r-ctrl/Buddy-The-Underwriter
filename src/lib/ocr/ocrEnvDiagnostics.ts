import "server-only";

export type OcrEnvDiagnostics = {
  useGeminiOcrEnabled: boolean;
  hasGoogleProject: boolean;
  hasGoogleCredentialsHint: boolean;
  googleLocation: string | null;
  geminiModel: string | null;
};

export function getOcrEnvDiagnostics(): OcrEnvDiagnostics {
  const useGeminiOcrEnabled = process.env.USE_GEMINI_OCR === "true";

  const hasGoogleProject = Boolean(
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID,
  );

  // Mirrors the credential sources supported by `runGeminiOcrJob`.
  const hasGoogleCredentialsHint = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GEMINI_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
      // Back-compat: some setups paste service-account JSON into GEMINI_API_KEY.
      process.env.GEMINI_API_KEY,
  );

  const googleLocation =
    process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_REGION || null;

  const geminiModel =
    process.env.GEMINI_OCR_MODEL || process.env.GEMINI_MODEL || null;

  return {
    useGeminiOcrEnabled,
    hasGoogleProject,
    hasGoogleCredentialsHint,
    googleLocation,
    geminiModel,
  };
}
