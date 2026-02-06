import "server-only";

/**
 * Unified Vercel OIDC token retrieval.
 *
 * ALL callers (GCS signing, DocAI, Vertex, storage-probe) MUST use this
 * function so token resolution never diverges.
 *
 * Priority:
 *   1. @vercel/oidc package (works in any Vercel server context, no Request needed)
 *   2. Request headers (x-vercel-oidc-token, x-vercel-oidc, Authorization)
 *   3. VERCEL_OIDC_TOKEN env var (cron / test contexts; logs warning)
 */

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

export async function getVercelOidcToken(req?: Request): Promise<string | null> {
  // 1. On Vercel, prefer the SDK (no request object needed)
  if (isVercelRuntime()) {
    try {
      const { getVercelOidcToken: getOidcFromSdk } = await import("@vercel/oidc");
      const token = await getOidcFromSdk();
      if (token) return token;
    } catch {
      // SDK unavailable or failed — fall through to request headers
    }
  }

  // 2. Extract from request headers (local testing or SDK fallback)
  if (req) {
    const headerToken = req.headers.get("x-vercel-oidc-token");
    if (headerToken) return headerToken;

    const fallback = req.headers.get("x-vercel-oidc");
    if (fallback) return fallback;

    const auth = req.headers.get("authorization") || "";
    if (auth.toLowerCase().startsWith("bearer ")) {
      const token = auth.slice(7).trim();
      if (token) return token;
    }
  }

  // 3. Env var fallback (cron jobs, tests)
  const envToken = process.env.VERCEL_OIDC_TOKEN;
  if (envToken) {
    console.warn("[oidc] Falling back to VERCEL_OIDC_TOKEN env var — prefer @vercel/oidc SDK");
    return envToken;
  }

  return null;
}
