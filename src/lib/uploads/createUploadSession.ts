import type { NextRequest } from "next/server";
import type { SignDealUploadOk, SignDealUploadErr } from "@/lib/uploads/signDealUpload";

export type UploadSessionFile = {
  filename: string;
  contentType?: string | null;
  sizeBytes: number;
  checklistKey?: string | null;
};

export type UploadSessionItem = {
  filename: string;
  objectKey: string;
  uploadUrl: string;
  headers: Record<string, string>;
  fileId: string;
  checklistKey?: string | null;
  bucket: string;
  sizeBytes: number;
};

export async function buildUploadSession(args: {
  req: NextRequest;
  dealId: string;
  files: UploadSessionFile[];
  requestId: string;
  signFile: (input: {
    req: NextRequest;
    dealId: string;
    file: UploadSessionFile;
    requestId: string;
  }) => Promise<SignDealUploadOk | SignDealUploadErr>;
}): Promise<UploadSessionItem[]> {
  const uploads: UploadSessionItem[] = [];

  for (let i = 0; i < args.files.length; i++) {
    const file = args.files[i];
    const signed = await args.signFile({
      req: args.req,
      dealId: args.dealId,
      file,
      requestId: `${args.requestId}_${i}`,
    });

    if (!signed.ok) {
      const err = new Error(signed.error || "sign_failed");
      (err as any).details = signed.details;
      throw err;
    }

    uploads.push({
      filename: file.filename,
      objectKey: signed.upload.objectKey,
      uploadUrl: signed.upload.uploadUrl,
      headers: signed.upload.headers,
      fileId: signed.upload.fileId,
      checklistKey: signed.upload.checklistKey ?? null,
      bucket: signed.upload.bucket,
      sizeBytes: file.sizeBytes,
    });
  }

  return uploads;
}
