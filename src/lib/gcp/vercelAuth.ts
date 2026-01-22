import "server-only";

import { IdentityPoolClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";
import { resolveAudience, resolveServiceAccountEmail } from "@/lib/gcp/wif";

export async function getVercelWifAuthClient(): Promise<IdentityPoolClient> {
  const oidc = await getVercelOidcToken();
  console.log("[gcs-auth] oidc-token-length", oidc?.length ?? 0);

  return new IdentityPoolClient({
    type: "external_account",
    audience: resolveAudience(),
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${resolveServiceAccountEmail()}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: async () => oidc,
    },
  });
}
