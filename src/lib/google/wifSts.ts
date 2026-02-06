import "server-only";

import { getWifProvider } from "@/lib/google/wif/getWifProvider";

const STS_URL = "https://sts.googleapis.com/v1/token";

export async function exchangeOidcForFederatedAccessToken(oidcJwt: string): Promise<string> {
  const provider = getWifProvider();
  const audience = `//iam.googleapis.com/${provider}`;

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
