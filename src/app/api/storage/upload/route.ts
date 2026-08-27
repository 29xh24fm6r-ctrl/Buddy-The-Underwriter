// src/app/api/storage/upload/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseStorageClient } from "@/lib/supabase/client";
import {
  buildGcsObjectKey,
  deleteGcsObject,
  getGcsBucketName,
  signGcsUploadUrl,
} from "@/lib/storage/gcs";
import { finalizeLegacyUpload } from "@/lib/uploads/finalizeLegacyUpload";
import { recordBorrowerUploadAndMaterialize } from "@/lib/uploads/recordBorrowerUploadAndMaterialize";
import crypto from "node:crypto";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

async function commitUploadedObject(args: {
  dealId: string;
  bankId: string;
  bucket: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  removeUncommittedObject: () => Promise<void>;
}) {
  const result = await finalizeLegacyUpload({
    commit: () =>
      recordBorrowerUploadAndMaterialize({
        dealId: args.dealId,
        bankId: args.bankId,
        storageBucket: args.bucket,
        storagePath: args.path,
        originalFilename: args.filename,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        source: "banker_upload",
      }),
    removeUncommittedObject: args.removeUncommittedObject,
  });

  const uploaded = {
    file_key: args.path,
    mime_type: args.mimeType,
    size: args.sizeBytes,
    bucket: args.bucket,
  };

  if (result.status === "committed") {
    return json(200, {
      ok: true,
      ...uploaded,
      upload_id: result.commit.uploadId,
      reconciled: result.commit.reconciled,
    });
  }

  if (result.status === "processing_pending") {
    console.error(
      JSON.stringify({
        level: "error",
        message: "legacy upload persisted but post-commit processing is pending",
        route: "/api/storage/upload",
        dealId: args.dealId,
        error: result.error,
      }),
    );
    return json(202, {
      ok: true,
      ...uploaded,
      durable: true,
      processing_pending: true,
    });
  }

  if (result.status === "rolled_back") {
    console.error(
      JSON.stringify({
        level: "error",
        message: "legacy upload audit failed; request object removed",
        route: "/api/storage/upload",
        dealId: args.dealId,
        error: result.error,
      }),
    );
    return json(503, {
      ok: false,
      error: "upload_commit_failed",
      bytes_removed: true,
    });
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: "legacy upload audit and compensation failed",
      route: "/api/storage/upload",
      dealId: args.dealId,
      error: result.error,
      cleanupError: result.cleanupError,
    }),
  );
  return json(503, {
    ok: false,
    error: "upload_commit_failed_cleanup_failed",
    requires_reconciliation: true,
  });
}

/**
 * POST /api/storage/upload
 * Legacy server-upload compatibility route.
 *
 * Every successful production write is committed to the durable upload audit
 * before success is returned. If that pre-commit write fails, only the object
 * created by this request is removed through the provider API.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;
    const dealId = formData.get("dealId") as string | null;
    const applicationId = formData.get("applicationId") as string | null;
    let filename = formData.get("filename") as string | null;

    if (!file) {
      return json(400, { ok: false, error: "Missing file" });
    }

    if (!dealId) {
      return json(400, { ok: false, error: "Missing dealId" });
    }

    let access: Awaited<ReturnType<typeof assertDealAccess>>;
    try {
      access = await assertDealAccess(dealId);
    } catch (error) {
      const accessResponse = accessErrorToResponse(error);
      if (accessResponse) return accessResponse;
      return json(500, { ok: false, error: "access_check_failed" });
    }

    if (!filename) {
      filename = file.name;
    }

    const storage = getSupabaseStorageClient();
    const docStore = String(process.env.DOC_STORE || "").toLowerCase();

    if (!storage) {
      if (process.env.NODE_ENV === "production") {
        return json(503, { ok: false, error: "storage_unavailable" });
      }
      return await handleLocalUpload(file, dealId, applicationId, filename);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || "application/octet-stream";

    if (docStore === "gcs") {
      const fileId = crypto.randomUUID();
      const objectPath = buildGcsObjectKey({
        bankId: access.bankId,
        dealId,
        fileId,
        filename,
      });

      const signedUploadUrl = await signGcsUploadUrl({
        key: objectPath,
        contentType: mimeType,
        expiresSeconds: Number(process.env.GCS_SIGNED_URL_TTL_SECONDS || "900"),
      });

      const uploadRes = await fetch(signedUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: buffer,
      });

      if (!uploadRes.ok) {
        return json(500, { ok: false, error: "Upload failed" });
      }

      const bucket = getGcsBucketName();
      return await commitUploadedObject({
        dealId,
        bankId: access.bankId,
        bucket,
        path: objectPath,
        filename,
        mimeType,
        sizeBytes: file.size,
        removeUncommittedObject: () =>
          deleteGcsObject({ bucket, key: objectPath }),
      });
    }

    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const basePath = applicationId
      ? `${dealId}/${applicationId}`
      : `${dealId}/uploads`;

    const fileKey = `${basePath}/${timestamp}_${safeName}`;
    const bucket = "deal_uploads";

    const { data, error } = await storage.from(bucket).upload(fileKey, buffer, {
      contentType: mimeType,
      upsert: false,
    });

    if (error) {
      console.error("[storage/upload] Supabase upload failed");
      return json(500, { ok: false, error: "upload_failed" });
    }

    return await commitUploadedObject({
      dealId,
      bankId: access.bankId,
      bucket,
      path: data.path,
      filename,
      mimeType,
      sizeBytes: file.size,
      removeUncommittedObject: async () => {
        const { error: removeError } = await storage.from(bucket).remove([data.path]);
        if (removeError) {
          throw new Error(removeError.message);
        }
      },
    });
  } catch (error: unknown) {
    console.error("[storage/upload] unexpected failure", error);
    return json(500, { ok: false, error: "upload_failed" });
  }
}

/**
 * Fallback: Local file system upload (development)
 */
async function handleLocalUpload(
  file: File,
  dealId: string,
  applicationId: string | null,
  filename: string,
) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const baseDir = applicationId
    ? path.join(process.cwd(), ".data", "uploads", dealId, applicationId)
    : path.join(process.cwd(), ".data", "uploads", dealId);

  await fs.mkdir(baseDir, { recursive: true });

  const timestamp = Date.now();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedName = `${timestamp}_${safeName}`;
  const filePath = path.join(baseDir, storedName);

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await fs.writeFile(filePath, buffer);

  const fileKey = applicationId
    ? `${dealId}/${applicationId}/${storedName}`
    : `${dealId}/uploads/${storedName}`;

  return json(200, {
    ok: true,
    file_key: fileKey,
    mime_type: file.type,
    size: file.size,
    storage: "local",
    path: filePath,
  });
}
