import "server-only";

import { getWifProvider, normalizeWifProvider } from "@/lib/google/wif/getWifProvider";

const STS_URL = "https://sts.googleapis.com/v1/token";

export async function exchangeOidcForFederatedAccessToken(oidcJwt: string): Promise<string> {
  const audience = normalizeWifProvider(getWifProvider());

  const body = {
    audience,
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    subjectToken: oidcJwt,
  };

  const res = await fetch(STS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error_description || json?.error || `sts_error_${res.status}`;
    throw new Error(msg);
  }

  const token = json?.access_token ? String(json.access_token) : null;
  if (!token) throw new Error("missing_sts_access_token");
  return token;
}
