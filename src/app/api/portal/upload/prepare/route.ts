import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import {
  assertBoundedJsonContentLength,
  parsePortalUploadPrepareRequest,
  PortalUploadBoundaryError,
} from "@/lib/portal/uploadCommitBoundary";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { rateLimit } from "@/lib/portal/ratelimit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signUploadUrl } from "@/lib/uploads/sign";
import { createDealUploadSession, upsertUploadSessionFile } from "@/lib/uploads/uploadSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(req: Request) {
  try {
    assertBoundedJsonContentLength(req.headers.get("content-length"));
    const body = await req.json().catch(() => {
      throw new PortalUploadBoundaryError("invalid_json", 400);
    });
    const input = parsePortalUploadPrepareRequest(body);

    const tokenKey = crypto.createHash("sha256").update(input.token).digest("hex").slice(0, 24);
    const rl = rateLimit(`portal:${tokenKey}:upload_prepare`, 20, 60_000);
    if (!rl.ok) return json({ error: "rate_limited" }, 429);

    let invite;
    try {
      invite = await resolveBorrowerToken(input.token);
    } catch {
      return json({ error: "invalid_or_expired_link" }, 401);
    }

    const sb = supabaseAdmin();
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const created = await createDealUploadSession({
      sb,
      dealId: invite.deal_id,
      bankId: invite.bank_id,
      source: "borrower",
      createdByName: invite.name ?? null,
      createdByEmail: invite.email ?? null,
    });
    const fileId = crypto.randomUUID();
    const path = `${invite.deal_id}/${created.sessionId}/${Date.now()}_${safeName}`;
    const bucket = process.env.SUPABASE_UPLOAD_BUCKET || "borrower_uploads";

    const signResult = await signUploadUrl({ bucket, objectPath: path });
    if (!signResult.ok) {
      console.error("[portal/upload/prepare] upload signing unavailable", {
        code: "upload_signing_unavailable",
      });
      return json({ error: "upload_signing_unavailable" }, 503);
    }

    const fileWrite = await upsertUploadSessionFile({
      sb,
      sessionId: created.sessionId,
      dealId: invite.deal_id,
      bankId: invite.bank_id,
      fileId,
      filename: input.filename,
      contentType: input.mimeType,
      sizeBytes: input.sizeBytes,
      objectKey: path,
      bucket,
    });
    if (fileWrite.error) {
      return json({ error: "upload_session_file_unavailable" }, 503);
    }

    const proof = await sb
      .from("deal_upload_session_files")
      .select("session_id, deal_id, bank_id, file_id, filename, content_type, size_bytes, object_key, bucket, status")
      .eq("session_id", created.sessionId)
      .eq("file_id", fileId)
      .eq("deal_id", invite.deal_id)
      .eq("bank_id", invite.bank_id)
      .maybeSingle();
    const row = proof.data as any;
    if (
      proof.error ||
      !row ||
      String(row.filename) !== input.filename ||
      String(row.content_type).toLowerCase() !== input.mimeType ||
      Number(row.size_bytes) !== input.sizeBytes ||
      String(row.object_key) !== path ||
      String(row.bucket) !== bucket ||
      String(row.status) !== "ready"
    ) {
      return json({ error: "upload_session_file_unproven" }, 503);
    }

    await logLedgerEvent({
      dealId: invite.deal_id,
      bankId: invite.bank_id,
      eventKey: "upload.session.created",
      uiState: "done",
      uiMessage: "Upload session created",
      meta: { source: "borrower", flow: "portal_prepare", file_count: 1 },
    });

    return json({
      bucket,
      path,
      signedUrl: signResult.signedUrl,
      token: signResult.token,
      mimeType: input.mimeType,
      requestId: signResult.requestId,
      uploadSessionId: created.sessionId,
      uploadSessionExpiresAt: created.expiresAt,
      fileId,
    });
  } catch (error) {
    if (error instanceof PortalUploadBoundaryError) {
      return json({ error: error.code }, error.status);
    }
    console.error("[portal/upload/prepare] preparation unavailable", {
      code: "upload_prepare_unavailable",
    });
    return json({ error: "upload_prepare_unavailable" }, 503);
  }
}
