import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { constantTimeEqual, hashPassword, sha256 } from "@/lib/security/tokens";
import { ingestDocument } from "@/lib/documents/ingestDocument";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { recordBorrowerUploadAndMaterialize } from "@/lib/uploads/recordBorrowerUploadAndMaterialize";
import { buildGcsObjectKey, getGcsBucketName, signGcsUploadUrl } from "@/lib/storage/gcs";
import { findExistingDocBySha } from "@/lib/storage/dedupe";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getClientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || null;
  return null;
}

function chaosPoint(req: Request, point: string) {
  // Enable chaos only if env is set AND header matches
  if (process.env.CHAOS_ENABLED !== "true") return;
  const h = (req.headers.get("x-chaos-point") || "").trim();
  if (h === point) {
    throw new Error(`CHAOS: forced failure at ${point}`);
  }
}

export async function POST(req: Request) {
  const form = await req.formData();

  const token = String(form.get("token") || "");
  const password = String(form.get("password") || "");
  const uploaderName = String(form.get("uploaderName") || "");
  const uploaderEmail = String(form.get("uploaderEmail") || "");
  const checklistKey = String(form.get("checklistKey") || "");

  const idempotencyKey = String(form.get("idempotencyKey") || ""); // NEW

  if (!token)
    return NextResponse.json(
      { ok: false, error: "Missing token." },
      { status: 400 },
    );

  const tokenHash = sha256(token);

  // Idempotency: if provided, return same response for same (tokenHash, idempotencyKey)
  if (idempotencyKey) {
    const prior = await supabaseAdmin()
      .from("upload_idempotency_keys")
      .select("response")
      .eq("token_hash", tokenHash)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (prior.data?.response) {
      return NextResponse.json(prior.data.response);
    }
  }

  chaosPoint(req, "pre_link_lookup");

  chaosPoint(req, "pre_link_lookup");

  // 1) Validate link
  const { data: link, error: linkErr } = await supabaseAdmin()
    .from("deal_upload_links")
    .select(
      "id, deal_id, token_hash, expires_at, revoked_at, single_use, used_at, require_password, password_salt, password_hash, uploader_email_hint, requested_keys",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (linkErr || !link)
    return NextResponse.json(
      { ok: false, error: "Invalid link." },
      { status: 404 },
    );

  const now = Date.now();
  if (link.revoked_at)
    return NextResponse.json(
      { ok: false, error: "Link revoked." },
      { status: 403 },
    );
  if (new Date(link.expires_at).getTime() < now)
    return NextResponse.json(
      { ok: false, error: "Link expired." },
      { status: 403 },
    );
  if (link.single_use && link.used_at)
    return NextResponse.json(
      { ok: false, error: "Link already used." },
      { status: 403 },
    );

  chaosPoint(req, "post_link_validation");

  chaosPoint(req, "post_link_validation");

  // 2) Validate password if required (constant-time compare)
  if (link.require_password) {
    if (!password)
      return NextResponse.json(
        { ok: false, error: "Password required." },
        { status: 401 },
      );
    const salt = String(link.password_salt || "");
    const expected = String(link.password_hash || "");
    if (!salt || !expected)
      return NextResponse.json(
        { ok: false, error: "Link misconfigured." },
        { status: 500 },
      );
    const actual = hashPassword(password, salt);
    if (!constantTimeEqual(actual, expected))
      return NextResponse.json(
        { ok: false, error: "Incorrect password." },
        { status: 401 },
      );
  }

  // 3) Extract files
  const files = form.getAll("files").filter(Boolean) as File[];
  if (files.length === 0)
    return NextResponse.json(
      { ok: false, error: "No files provided." },
      { status: 400 },
    );

  const dealId = String(link.deal_id);
  const bucket = "deal-uploads";
  const docStore = String(process.env.DOC_STORE || "").toLowerCase();

  // Fetch deal to get bank_id (required for ingestion)
  const { data: deal } = await supabaseAdmin()
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal)
    return NextResponse.json(
      { ok: false, error: "Deal not found." },
      { status: 404 },
    );

  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent");

  let successCount = 0;

  for (const f of files) {
    chaosPoint(req, "before_storage_upload");
    chaosPoint(req, "before_storage_upload");

    const arrayBuffer = await f.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    const safeName = (f.name || "upload").replace(/[^\w.\-()+\s]/g, "_");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const random = sha256(`${safeName}:${ts}:${Math.random()}`).slice(0, 12);

    const sha = sha256(bytes.toString("hex"));
    let storagePath = `deals/${dealId}/borrower/${ts}_${random}_${safeName}`;
    let storageBucket = bucket;

    if (docStore === "gcs") {
      const existing = await findExistingDocBySha({
        sb: supabaseAdmin(),
        dealId,
        sha256: sha,
      });

      if (existing?.storage_path && existing.storage_bucket) {
        storagePath = existing.storage_path;
        storageBucket = existing.storage_bucket;

        await logLedgerEvent({
          dealId,
          bankId: deal.bank_id,
          eventKey: "documents.upload_deduped",
          uiState: "done",
          uiMessage: "Upload deduped by sha256",
          meta: {
            existing_document_id: existing.id,
            sha256: sha,
            source: "public_link",
          },
        });
      } else {
        const gcsBucket = getGcsBucketName();
        const fileId = crypto.randomUUID();
        storagePath = buildGcsObjectKey({
          bankId: deal.bank_id,
          dealId,
          fileId,
          filename: f.name || "upload",
        });
        storageBucket = gcsBucket;

        const signedUploadUrl = await signGcsUploadUrl({
          key: storagePath,
          contentType: f.type || "application/octet-stream",
          expiresSeconds: Number(process.env.GCS_SIGNED_URL_TTL_SECONDS || "900"),
        });

        const uploadRes = await fetch(signedUploadUrl, {
          method: "PUT",
          headers: { "Content-Type": f.type || "application/octet-stream" },
          body: bytes,
        });

        if (!uploadRes.ok) {
          return NextResponse.json(
            { ok: false, error: `Upload failed: ${safeName}` },
            { status: 500 },
          );
        }
      }
    } else {
      const up = await supabaseAdmin()
        .storage.from(bucket)
        .upload(storagePath, bytes, {
          contentType: f.type || "application/octet-stream",
          upsert: false,
        });

      if (up.error)
        return NextResponse.json(
          { ok: false, error: `Upload failed: ${safeName}` },
          { status: 500 },
        );
    }

    chaosPoint(req, "after_storage_upload");

    // Canonical ingestion: insert doc + stamp checklist + reconcile + log ledger
    const docResult = await ingestDocument({
      dealId,
      bankId: deal.bank_id,
      file: {
        original_filename: f.name || "upload",
        mimeType: f.type || "application/octet-stream",
        sizeBytes: bytes.length,
        storagePath,
        storageBucket,
        sha256: sha,
      },
      source: "public_link",
      metadata: {
        checklist_key: checklistKey || null,
        uploaded_via_link_id: link.id,
        sha256: sha,
      },
    });

    // ✅ Audit trail: record borrower_uploads row for this upload (idempotent)
    // Note: borrower_uploads.request_id is a FK to borrower_document_requests, so we do NOT store link.id there.
    await recordBorrowerUploadAndMaterialize({
      dealId,
      bankId: deal.bank_id,
      requestId: null,
      storageBucket,
      storagePath,
      originalFilename: f.name || "upload",
      mimeType: f.type || "application/octet-stream",
      sizeBytes: bytes.length,
      source: "public_link",
      // This route already materializes via ingestDocument.
      materialize: false,
    });

    chaosPoint(req, "after_db_insert");

    // 5) Audit trail (view-backed or table-backed depending on your schema)
    // If deal_upload_audit is a VIEW and not insertable, skip inserts here.
    // If you have a write table (like deal_upload_events), use that instead.
    // We'll attempt insert and ignore "cannot insert into view" errors.
    const auditIns = await supabaseAdmin()
      .from("deal_upload_audit")
      .insert({
        deal_id: dealId,
        uploaded_by_user: null,
        uploaded_via_link_id: link.id,
        uploader_type: "borrower",
        uploader_display_name: uploaderName || null,
        uploader_email: uploaderEmail || link.uploader_email_hint || null,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        original_filename: f.name || "upload",
        mime_type: f.type || null,
        size_bytes: bytes.length,
        client_ip: ip,
        user_agent: ua,
        checklist_key: checklistKey || null,
      } as any);

    if (
      auditIns.error &&
      !String(auditIns.error.message || "")
        .toLowerCase()
        .includes("view")
    ) {
      return NextResponse.json(
        { ok: false, error: "Failed to write audit trail." },
        { status: 500 },
      );
    }

    successCount++;

    await logLedgerEvent({
      dealId,
      bankId: deal.bank_id,
      eventKey: "documents.upload_completed",
      uiState: "done",
      uiMessage: `Upload completed (${docStore === "gcs" ? "gcs" : "supabase"})`,
      meta: {
        storage_bucket: storageBucket,
        storage_path: storagePath,
        size_bytes: bytes.length,
        sha256: sha,
        source: "public_link",
      },
    });
  }

  // 🧠 CONVERGENCE: Recompute deal readiness after all files processed
  if (successCount > 0) {
    try {
      await recomputeDealReady(dealId);
    } catch (e) {
      console.error("Recompute readiness failed (non-blocking):", e);
    }
  }

  // 7) Mark link used if single_use
  if (link.single_use) {
    await supabaseAdmin()
      .from("deal_upload_links")
      .update({ used_at: new Date().toISOString() })
      .eq("id", link.id);
  }

  const response = { ok: true, count: successCount };

  // 8) Persist idempotent response
  if (idempotencyKey) {
    await supabaseAdmin()
      .from("upload_idempotency_keys")
      .insert({
        token_hash: tokenHash,
        idempotency_key: idempotencyKey,
        response,
      })
      .throwOnError();
  }

  return NextResponse.json(response);
}
