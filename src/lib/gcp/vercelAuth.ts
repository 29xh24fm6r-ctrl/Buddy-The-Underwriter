import "server-only";

import { IdentityPoolClient } from "google-auth-library";
import { getVercelOidcToken } from "@/lib/google/getVercelOidcToken";
import { resolveAudience, resolveServiceAccountEmail } from "@/lib/gcp/wif";

export async function getVercelWifAuthClient(): Promise<IdentityPoolClient> {
  const oidc = await getVercelOidcToken();
  if (!oidc) {
    throw new Error(
      "Unable to obtain Vercel OIDC token. Ensure this runs on Vercel with OIDC enabled, " +
      "or set VERCEL_OIDC_TOKEN for local testing.",
    );
  }
  console.log("[gcs-auth] oidc-token-length", oidc.length);
  const scopes = ["https://www.googleapis.com/auth/cloud-platform"];

  return new IdentityPoolClient({
    type: "external_account",
    audience: resolveAudience(),
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${resolveServiceAccountEmail()}:generateAccessToken`,
    scopes,
    subject_token_supplier: {
      getSubjectToken: async () => oidc,
    },
  });
}
