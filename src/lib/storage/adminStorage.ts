import crypto from "node:crypto";
import {
  createDocumentDownloadUrl,
  downloadDocumentBytes,
  uploadDocumentBytes,
} from "@/lib/storage/documentBytes";

export function sha256(bytes: Uint8Array) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export async function uploadPrivateObject(args: {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
  upsert?: boolean;
}) {
  await uploadDocumentBytes({
    bucket: args.bucket,
    path: args.path,
    bytes: args.bytes,
    contentType: args.contentType,
    upsert: args.upsert ?? true,
  });
  return { path: args.path };
}

export async function createSignedDownloadUrl(args: {
  bucket: string;
  path: string;
  expiresInSeconds?: number;
}) {
  return createDocumentDownloadUrl({
    bucket: args.bucket,
    path: args.path,
    expiresInSeconds: args.expiresInSeconds ?? 60 * 10,
  });
}

export async function downloadPrivateObject(args: { bucket: string; path: string }) {
  const bytes = await downloadDocumentBytes({ bucket: args.bucket, path: args.path });
  return new Uint8Array(bytes);
}
