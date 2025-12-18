import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
  const { data, error } = await supabaseAdmin().storage
    .from(args.bucket)
    .upload(args.path, args.bytes, {
      contentType: args.contentType,
      upsert: args.upsert ?? true,
    }) as any;

  if (error) throw error;
  return data;
}

export async function createSignedDownloadUrl(args: {
  bucket: string;
  path: string;
  expiresInSeconds?: number;
}) {
  const { data, error } = await supabaseAdmin().storage
    .from(args.bucket)
    .createSignedUrl(args.path, args.expiresInSeconds ?? 60 * 10) as any;

  if (error) throw error;
  return data.signedUrl;
}

export async function downloadPrivateObject(args: { bucket: string; path: string }) {
  const { data, error } = await supabaseAdmin().storage.from(args.bucket).download(args.path) as any;
  if (error) throw error;

  const ab = await data.arrayBuffer();
  return new Uint8Array(ab);
}
