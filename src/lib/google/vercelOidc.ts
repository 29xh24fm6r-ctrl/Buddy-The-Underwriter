import "server-only";

export function getVercelOidcToken(req: Request): string | null {
  const headerToken = req.headers.get("x-vercel-oidc-token");
  if (headerToken) return headerToken;

  const fallback = req.headers.get("x-vercel-oidc");
  if (fallback) return fallback;

  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }

  const envToken = process.env.VERCEL_OIDC_TOKEN;
  if (envToken) return envToken;

  return null;
}
