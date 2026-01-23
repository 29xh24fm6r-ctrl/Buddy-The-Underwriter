import "server-only";

import crypto from "node:crypto";

export type V4SignedPutOptions = {
  bucket: string;
  objectKey: string;
  contentType: string;
  expiresSeconds: number;
  region: string;
  serviceAccountEmail: string;
  host?: string;
  now?: Date;
  signBlob: (bytes: Uint8Array) => Promise<Uint8Array>;
};

function formatDateParts(date: Date) {
  const iso = date.toISOString().replace(/[-:]/g, "");
  const dateStamp = iso.slice(0, 8);
  const dateTime = `${dateStamp}T${iso.slice(9, 15)}Z`;
  return { dateStamp, dateTime };
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function encodeRFC3986(input: string) {
  return encodeURIComponent(input).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeUriPath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeRFC3986(segment))
    .join("/");
}

function canonicalQuery(params: Record<string, string>) {
  const entries = Object.entries(params)
    .map(([k, v]) => [encodeRFC3986(k), encodeRFC3986(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));

  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

export async function createV4SignedPutUrl(opts: V4SignedPutOptions): Promise<{
  url: string;
  headers: Record<string, string>;
  objectKey: string;
}> {
  const host = opts.host || "storage.googleapis.com";
  const now = opts.now ?? new Date();
  const { dateStamp, dateTime } = formatDateParts(now);

  const credentialScope = `${dateStamp}/${opts.region}/storage/goog4_request`;
  const credential = `${opts.serviceAccountEmail}/${credentialScope}`;

  const canonicalUri = `/${encodeRFC3986(opts.bucket)}/${encodeUriPath(opts.objectKey)}`;

  const queryParams = {
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": dateTime,
    "X-Goog-Expires": String(opts.expiresSeconds),
    "X-Goog-SignedHeaders": "content-type;host",
  };

  const canonicalHeaders = `content-type:${opts.contentType}\n` + `host:${host}\n`;
  const signedHeaders = "content-type;host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery(queryParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "GOOG4-RSA-SHA256",
    dateTime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signatureBytes = await opts.signBlob(new TextEncoder().encode(stringToSign));
  const signature = Buffer.from(signatureBytes).toString("hex");

  const finalQuery = `${canonicalQuery(queryParams)}&X-Goog-Signature=${signature}`;
  const url = `https://${host}${canonicalUri}?${finalQuery}`;

  return {
    url,
    headers: { "Content-Type": opts.contentType },
    objectKey: opts.objectKey,
  };
}
