import "server-only";
import { createDocumentDownloadUrl } from "@/lib/storage/documentBytes";

export async function getSignedPdfUrl(args: {
  bucket: string;
  path: string;
  expiresInSeconds?: number;
}) {
  const expiresIn = args.expiresInSeconds ?? 60 * 15;

  return createDocumentDownloadUrl({
    bucket: args.bucket,
    path: args.path,
    expiresInSeconds: expiresIn,
  });
}
