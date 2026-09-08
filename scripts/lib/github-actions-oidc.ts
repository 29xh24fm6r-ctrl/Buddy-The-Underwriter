export const BROKERAGE_CERTIFICATION_AUDIENCE =
  "buddy-brokerage-production-certification";

export async function getGitHubActionsOidcToken(): Promise<string> {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error("GitHub Actions OIDC identity is unavailable");
  }

  const url = new URL(requestUrl);
  url.searchParams.set("audience", BROKERAGE_CERTIFICATION_AUDIENCE);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${requestToken}` },
  });
  if (!response.ok) {
    throw new Error(`GitHub Actions OIDC request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { value?: unknown };
  if (typeof body.value !== "string" || body.value.length === 0) {
    throw new Error("GitHub Actions OIDC response did not include a token");
  }
  return body.value;
}
