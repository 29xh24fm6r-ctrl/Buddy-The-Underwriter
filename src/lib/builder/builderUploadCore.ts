import crypto from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "deal_uploads";

type Context = {
  params: Promise<{ dealId: string }>;
};

type StorageUploadResult = {
  storageBucket: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
  originalFilename: string;
};

type BuilderUploadDeps = {
  mustBuilderToken?: (req: Request) => { ok: true };
  resolveBuilderBankId?: (sb?: SupabaseClient) => Promise<string>;
  supabaseAdmin?: () => SupabaseClient;
  ingestDocument?: (input: any) => Promise<any>;
  initializeIntake?: (dealId: string, bankId?: string | null, opts?: any) => Promise<any>;
  getSupabaseStorageClient?: () => any;
  buildGcsObjectKey?: (args: any) => string;
  getGcsClient?: () => Promise<any>;
  getGcsBucketName?: () => string;
  logLedgerEvent?: (args: any) => Promise<any>;
  getLatestLockedQuoteId?: (sb: SupabaseClient, dealId: string) => Promise<string | null>;
  verifyUnderwriteCore?: (args: any) => Promise<any>;
  randomUUID?: () => string;
};

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function uploadToLocal(
  file: File,
  dealId: string,
): Promise<StorageUploadResult> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const baseDir = path.join("/tmp", "buddy_uploads", dealId, "builder");
  await fs.mkdir(baseDir, { recursive: true });

  const timestamp = Date.now();
  const filename = file.name || "upload.bin";
  const storedName = `${timestamp}_${safeName(filename)}`;
  const filePath = path.join(baseDir, storedName);

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(filePath, buffer);

  return {
    storageBucket: "local",
    storagePath: `${dealId}/builder/${storedName}`,
    sizeBytes: file.size,
    mimeType: file.type || "application/octet-stream",
    originalFilename: filename,
  };
}

async function uploadBytes(
  buffer: Buffer,
  args: { dealId: string; bankId: string; filename: string; mimeType: string },
  deps: BuilderUploadDeps,
): Promise<StorageUploadResult> {
  const docStore = String(process.env.DOC_STORE || "").toLowerCase();
  const filename = args.filename || "upload.bin";
  const mimeType = args.mimeType || "application/octet-stream";

  if (docStore === "gcs") {
    console.log("[upload] using bucket", process.env.GCS_BUCKET);
    const getGcsClient =
      deps.getGcsClient ??
      (await import("@/lib/storage/gcs")).getGcsClient;

    if (!getGcsClient) {
      throw new Error("gcs_helpers_missing");
    }

    const documentId = (deps.randomUUID ?? (() => crypto.randomUUID()))();
    const objectPath = `deals/${args.dealId}/documents/${documentId}/${safeName(filename)}`;

    const storage = await getGcsClient();
    const bucket = storage.bucket(process.env.GCS_BUCKET!);
    const file = bucket.file(objectPath);
    const fileBuffer = buffer;
    try {
      await file.save(fileBuffer, {
        resumable: false,
        contentType: mimeType ?? "application/pdf",
        metadata: { cacheControl: "private, max-age=0, no-transform" },
      });
    } catch (err: any) {
      console.log("[upload] gcs-upload-error", {
        name: err?.name,
        message: err?.message,
      });
      throw err;
    }

    return {
      storageBucket: process.env.GCS_BUCKET!,
      storagePath: objectPath,
      sizeBytes: buffer.length,
      mimeType,
      originalFilename: filename,
    };
  }

  const getStorage = deps.getSupabaseStorageClient ??
    (await import("@/lib/supabase/client")).getSupabaseStorageClient;
  const storage = getStorage();
  if (!storage) {
    return uploadToLocal(
      new File([new Uint8Array(buffer)], filename, { type: mimeType }),
      args.dealId,
    );
  }

  const timestamp = Date.now();
  const fileKey = `${args.dealId}/uploads/${timestamp}_${safeName(filename)}`;

  const { data, error } = await storage.from(DEFAULT_UPLOAD_BUCKET).upload(fileKey, buffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error || !data?.path) {
    throw new Error(error?.message || "storage_upload_failed");
  }

  return {
    storageBucket: DEFAULT_UPLOAD_BUCKET,
    storagePath: data.path,
    sizeBytes: buffer.length,
    mimeType,
    originalFilename: filename,
  };
}

async function uploadFile(
  file: File,
  args: { dealId: string; bankId: string },
  deps: BuilderUploadDeps,
): Promise<StorageUploadResult> {
  const docStore = String(process.env.DOC_STORE || "").toLowerCase();
  const filename = file.name || "upload.bin";
  const mimeType = file.type || "application/octet-stream";

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (docStore === "gcs") {
    console.log("[upload] using bucket", process.env.GCS_BUCKET);
    const getGcsClient =
      deps.getGcsClient ??
      (await import("@/lib/storage/gcs")).getGcsClient;

    if (!getGcsClient) {
      throw new Error("gcs_helpers_missing");
    }

    const documentId = (deps.randomUUID ?? (() => crypto.randomUUID()))();
    const objectPath = `deals/${args.dealId}/documents/${documentId}/${safeName(filename)}`;

    const storage = await getGcsClient();
    const bucket = storage.bucket(process.env.GCS_BUCKET!);
    const file = bucket.file(objectPath);
    const fileBuffer = buffer;
    try {
      await file.save(fileBuffer, {
        resumable: false,
        contentType: mimeType ?? "application/pdf",
        metadata: { cacheControl: "private, max-age=0, no-transform" },
      });
    } catch (err: any) {
      console.log("[upload] gcs-upload-error", {
        name: err?.name,
        message: err?.message,
      });
      throw err;
    }

    return {
      storageBucket: process.env.GCS_BUCKET!,
      storagePath: objectPath,
      sizeBytes: file.size,
      mimeType,
      originalFilename: filename,
    };
  }

  const getStorage = deps.getSupabaseStorageClient ??
    (await import("@/lib/supabase/client")).getSupabaseStorageClient;
  const storage = getStorage();
  if (!storage) {
    return uploadToLocal(file, args.dealId);
  }

  const timestamp = Date.now();
  const fileKey = `${args.dealId}/uploads/${timestamp}_${safeName(filename)}`;

  const { data, error } = await storage.from(DEFAULT_UPLOAD_BUCKET).upload(fileKey, buffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error || !data?.path) {
    throw new Error(error?.message || "storage_upload_failed");
  }

  return {
    storageBucket: DEFAULT_UPLOAD_BUCKET,
    storagePath: data.path,
    sizeBytes: file.size,
    mimeType,
    originalFilename: filename,
  };
}

export function createBuilderUploadHandler(overrides: BuilderUploadDeps = {}) {
  return async function POST(req: Request, ctx: Context) {
    try {
      const mustBuilderToken = overrides.mustBuilderToken ??
        (await import("@/lib/builder/mustBuilderToken")).mustBuilderToken;

      if (!mustBuilderToken) {
        throw new Error("builder_token_guard_missing");
      }

      mustBuilderToken(req);

      const { dealId } = await ctx.params;
      if (!dealId) {
        const { NextResponse } = await import("next/server");
        return NextResponse.json({ ok: false, error: "missing_deal_id" }, { status: 400 });
      }

      const contentType = req.headers.get("content-type") || "";
      let checklistKey: string | null = null;
      let upload: StorageUploadResult | null = null;
      let uploadRequest:
        | { type: "json"; buffer: Buffer; filename: string; mimeType: string; checklistKey: string | null }
        | { type: "file"; file: File; checklistKey: string | null };

      if (contentType.includes("application/json")) {
        const body = await req.json().catch(() => ({}));
        const base64 = typeof body?.base64 === "string" ? body.base64 : null;
        const filename = typeof body?.filename === "string" ? body.filename : "upload.bin";
        const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "application/octet-stream";

        if (!base64) {
          const { NextResponse } = await import("next/server");
          return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
        }

        const key = typeof body?.checklistKey === "string" ? body.checklistKey.trim() : null;
        uploadRequest = {
          type: "json",
          buffer: Buffer.from(base64, "base64"),
          filename,
          mimeType,
          checklistKey: key,
        };
      } else {
        const form = await req.formData();
        const file = form.get("file");

        if (!(file instanceof File)) {
          const { NextResponse } = await import("next/server");
          return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
        }

        const checklistKeyRaw =
          form.get("checklistKey") ??
          form.get("checklist_key") ??
          form.get("taskKey") ??
          form.get("task_key");
        const key =
          typeof checklistKeyRaw === "string" && checklistKeyRaw.trim()
            ? checklistKeyRaw.trim()
            : null;

        uploadRequest = { type: "file", file, checklistKey: key };
      }

      const supabaseAdmin = overrides.supabaseAdmin ??
        (await import("@/lib/supabase/admin")).supabaseAdmin;
      const sb = supabaseAdmin();

      const { data: deal, error: dealErr } = await sb
        .from("deals")
        .select("id, bank_id")
        .eq("id", dealId)
        .maybeSingle();

      if (dealErr) {
        const { NextResponse } = await import("next/server");
        return NextResponse.json(
          { ok: false, error: "deal_lookup_failed", message: dealErr.message },
          { status: 500 },
        );
      }

      if (!deal) {
        const { NextResponse } = await import("next/server");
        return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
      }

      const resolveBuilderBankId = overrides.resolveBuilderBankId ??
        (await import("@/lib/builder/resolveBuilderBankId")).resolveBuilderBankId;
      const resolvedBankId = deal.bank_id
        ? String(deal.bank_id)
        : await resolveBuilderBankId(sb);

      if (deal.bank_id && resolvedBankId && String(deal.bank_id) !== String(resolvedBankId)) {
        const { NextResponse } = await import("next/server");
        return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
      }

      const initializeIntake = overrides.initializeIntake ??
        (await import("@/lib/deals/intake/initializeIntake")).initializeIntake;
      await initializeIntake(dealId, resolvedBankId, {
        reason: "builder_upload",
        trigger: "auto",
      });

      if (uploadRequest.type === "json") {
        checklistKey = uploadRequest.checklistKey;
        upload = await uploadBytes(
          uploadRequest.buffer,
          {
            dealId,
            bankId: resolvedBankId,
            filename: uploadRequest.filename,
            mimeType: uploadRequest.mimeType,
          },
          overrides,
        );
      } else {
        checklistKey = uploadRequest.checklistKey;
        upload = await uploadFile(uploadRequest.file, { dealId, bankId: resolvedBankId }, overrides);
      }

      const ingestDocument = overrides.ingestDocument ??
        (await import("@/lib/documents/ingestDocument")).ingestDocument;
      const ingest = await ingestDocument({
        dealId,
        bankId: resolvedBankId,
        file: {
          original_filename: upload.originalFilename,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          storagePath: upload.storagePath,
          storageBucket: upload.storageBucket,
        },
        source: "internal",
        metadata: {
          builder_upload: true,
          checklist_key: checklistKey,
        },
      });

      const { data: checklistRows } = await sb
        .from("deal_checklist_items")
        .select("checklist_key, required, received_at")
        .eq("deal_id", dealId);

      const satisfiedChecklistKeys = (checklistRows ?? [])
        .filter((row: any) => row?.required && row?.received_at)
        .map((row: any) => String(row?.checklist_key ?? ""))
        .filter(Boolean);

      const verifyUnderwriteCore = overrides.verifyUnderwriteCore ??
        (await import("@/lib/deals/verifyUnderwriteCore")).verifyUnderwriteCore;
      const logLedgerEvent = overrides.logLedgerEvent ??
        (await import("@/lib/pipeline/logLedgerEvent")).logLedgerEvent;
      const getLatestLockedQuoteId = overrides.getLatestLockedQuoteId ??
        (await import("@/lib/pricing/getLatestLockedQuote")).getLatestLockedQuoteId;

      const verify = await verifyUnderwriteCore({
        dealId,
        logAttempt: false,
        deps: {
          sb,
          logLedgerEvent,
          getLatestLockedQuoteId,
        },
      });

      const { NextResponse } = await import("next/server");
      return NextResponse.json({
        ok: true,
        dealId,
        storage: {
          bucket: upload.storageBucket,
          path: upload.storagePath,
          size_bytes: upload.sizeBytes,
          mime_type: upload.mimeType,
        },
        document: {
          id: ingest.documentId,
          checklistKey: ingest.checklistKey ?? null,
          docYear: ingest.docYear ?? null,
          matchConfidence: ingest.matchConfidence ?? null,
          matchReason: ingest.matchReason ?? null,
        },
        satisfiedChecklistKeys,
        verifyHint: {
          ok: verify.ok,
          recommendedNextAction: verify.ok ? null : verify.recommendedNextAction,
        },
      });
    } catch (error: any) {
      if (error instanceof Response) {
        return error;
      }
      const { NextResponse } = await import("next/server");
      return NextResponse.json(
        {
          ok: false,
          error: "builder_upload_failed",
          message: String(error?.message ?? error),
        },
        { status: 500 },
      );
    }
  };
}
