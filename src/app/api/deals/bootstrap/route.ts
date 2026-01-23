import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { signDealUpload } from "@/lib/uploads/signDealUpload";
import { buildUploadSession } from "@/lib/uploads/createUploadSession";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { normalizeBootstrapPayload } from "@/lib/deals/bootstrapPayload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || `deal_bootstrap_${Date.now()}`;
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", requestId },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => ({} as any));
    const normalized = normalizeBootstrapPayload(body);
    if (!normalized.ok) {
      return NextResponse.json(
        { ok: false, error: normalized.error, requestId },
        { status: 400 },
      );
    }
    const { dealName, files: normalizedFiles } = normalized.payload;

    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const bootstrap = await withTimeout(
      sb.rpc("deal_bootstrap_create", {
        p_bank_id: bankId,
        p_name: dealName,
        p_created_by: userId,
      }),
      8_000,
      "deal_bootstrap_create",
    );

    if (bootstrap.error || !bootstrap.data?.[0]) {
      return NextResponse.json(
        { ok: false, error: bootstrap.error?.message || "bootstrap_failed", requestId },
        { status: 500 },
      );
    }

    const row = bootstrap.data[0] as { deal_id: string; session_id: string; expires_at: string };
    const dealId = row.deal_id;
    const sessionId = row.session_id;
    const expiresAt = row.expires_at;

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "deal.created",
      uiState: "done",
      uiMessage: "Deal created",
      meta: { deal_name: dealName },
    });

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "upload.session.created",
      uiState: "done",
      uiMessage: "Upload session created",
      meta: { session_id: sessionId, expires_at: expiresAt },
    });

    await initializeIntake(dealId, bankId, { reason: "bootstrap" });

    let uploads;
    try {
      uploads = await buildUploadSession({
        req,
        dealId,
        files: normalizedFiles,
        requestId,
        signFile: ({ req: innerReq, dealId: innerDealId, file, requestId: innerRequestId }) =>
          signDealUpload({
            req: innerReq,
            dealId: innerDealId,
            filename: file.filename,
            mimeType: file.contentType || null,
            sizeBytes: file.sizeBytes,
            checklistKey: file.checklistKey,
            requestId: innerRequestId,
          }),
      });
    } catch (err: any) {
      await sb
        .from("deal_upload_sessions")
        .update({ status: "failed" })
        .eq("id", sessionId);
      return NextResponse.json(
        { ok: false, error: err?.message || "upload_session_failed", requestId },
        { status: 500 },
      );
    }

    const fileRows = uploads.map((u) => ({
      session_id: sessionId,
      deal_id: dealId,
      bank_id: bankId,
      file_id: u.fileId,
      filename: u.filename,
      content_type: u.headers?.["Content-Type"] || u.headers?.["content-type"] || "application/octet-stream",
      size_bytes: u.sizeBytes,
      object_key: u.objectKey,
      bucket: u.bucket,
      status: "ready",
    }));

    const ins = await sb.from("deal_upload_session_files").insert(fileRows);
    if (ins.error) {
      await sb
        .from("deal_upload_sessions")
        .update({ status: "failed" })
        .eq("id", sessionId);
      return NextResponse.json(
        { ok: false, error: "session_files_insert_failed", requestId },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      dealId,
      uploadSession: {
        sessionId,
        expiresAt,
        files: uploads.map((u) => ({
          fileId: u.fileId,
          signedUrl: u.uploadUrl,
          method: "PUT" as const,
          contentType: u.headers?.["Content-Type"] || u.headers?.["content-type"] || "application/octet-stream",
          sizeBytes: u.sizeBytes,
          headers: u.headers,
          objectKey: u.objectKey,
          bucket: u.bucket,
          checklistKey: u.checklistKey ?? null,
          filename: u.filename,
        })),
      },
      intakeState: "UPLOAD_SESSION_READY",
      requestId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "bootstrap_failed", requestId },
      { status: 500 },
    );
  }
}
