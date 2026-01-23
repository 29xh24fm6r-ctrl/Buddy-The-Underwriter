import "server-only";

function envRequired(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64DecodeToBytes(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "base64"));
}

export async function generateAccessToken(federatedAccessToken: string): Promise<string> {
  const saEmail = envRequired("GCP_SERVICE_ACCOUNT_EMAIL");
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(
    saEmail,
  )}:generateAccessToken`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${federatedAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scope: ["https://www.googleapis.com/auth/cloud-platform"],
      lifetime: "900s",
    }),
  });

  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || json?.error || `iam_access_token_error_${res.status}`;
    throw new Error(msg);
  }

  const token = json?.accessToken ? String(json.accessToken) : null;
  if (!token) throw new Error("missing_service_account_access_token");
  return token;
}

export async function signBlob(saAccessToken: string, bytes: Uint8Array): Promise<Uint8Array> {
  const saEmail = envRequired("GCP_SERVICE_ACCOUNT_EMAIL");
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(
    saEmail,
  )}:signBlob`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${saAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: base64Encode(bytes) }),
  });

  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || json?.error || `iam_signblob_error_${res.status}`;
    throw new Error(msg);
  }

  const signedBlob = json?.signedBlob ? String(json.signedBlob) : null;
  if (!signedBlob) throw new Error("missing_signed_blob");
  return base64DecodeToBytes(signedBlob);
}
