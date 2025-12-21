import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getSignedPdfUrl(args: {
  bucket: string;
  path: string;
  expiresInSeconds?: number;
}) {
  const sb = supabaseAdmin();
  const expiresIn = args.expiresInSeconds ?? 60 * 15;

  const { data, error } = await sb.storage.from(args.bucket).createSignedUrl(args.path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
