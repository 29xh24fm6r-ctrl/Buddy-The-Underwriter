import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildUploadSession } from "@/lib/uploads/createUploadSession";
import { signDealUpload } from "@/lib/uploads/signDealUpload";
import { createDealUploadSession, upsertUploadSessionFile } from "@/lib/uploads/uploadSession";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";

export type UploadSessionSource = "banker" | "borrower";

type UploadSessionFileInput = {
  name: string;
  size: number;
  mime?: string | null;
};

type CreateUploadSessionBody = {
  dealId?: string | null;
  dealName?: string | null;
  source?: UploadSessionSource | string | null;
  files?: UploadSessionFileInput[] | null;
  portalToken?: string | null;
  portalLinkId?: string | null;
  createdByName?: string | null;
  createdByEmail?: string | null;
};

function generateDealName() {
  const now = new Date();
  const date = now.toLocaleDateString("en-US");
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `Deal - ${date} - ${rand}`;
}

async function resolveBorrowerLink(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  portalToken?: string | null;
  portalLinkId?: string | null;
}) {
  if (args.portalToken) {
    const { data, error } = await args.sb
      .from("borrower_portal_links")
      .select("id, deal_id, bank_id, expires_at")
      .eq("token", args.portalToken)
      .maybeSingle();

    if (error || !data) return { ok: false as const, error: "Invalid or expired link" };
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { ok: false as const, error: "Link expired" };
    }
    return { ok: true as const, link: data };
  }

  if (args.portalLinkId) {
    const { data, error } = await args.sb
      .from("borrower_portal_links")
      .select("id, deal_id, bank_id, expires_at")
      .eq("id", args.portalLinkId)
      .maybeSingle();

    if (error || !data) return { ok: false as const, error: "Invalid link" };
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { ok: false as const, error: "Link expired" };
    }
    return { ok: true as const, link: data };
  }

  return { ok: false as const, error: "Missing portal link" };
}

export async function handleCreateUploadSession(
  req: NextRequest,
  args?: { dealIdOverride?: string | null },
) {
  const requestId = req.headers.get("x-request-id") || `upload_session_${Date.now()}`;
  const body = (await req.json().catch(() => ({}))) as CreateUploadSessionBody;

  const source = body.source === "borrower" ? "borrower" : "banker";
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) {
    return NextResponse.json(
      { ok: false, error: "missing_files", requestId },
      { status: 400 },
    );
  }

  const normalizedFiles = files.map((f) => ({
    filename: String(f?.name || ""),
    contentType: f?.mime ? String(f.mime) : null,
    sizeBytes: Number(f?.size || 0),
  }));

  if (normalizedFiles.some((f) => !f.filename || !f.sizeBytes)) {
    return NextResponse.json(
      { ok: false, error: "invalid_file_payload", requestId },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const overrideDealId = args?.dealIdOverride ?? null;
  let dealId = overrideDealId || (body.dealId ? String(body.dealId) : null);
  let bankId: string | null = null;
  let sessionId: string | null = null;
  let expiresAt: string | null = null;
  let displayName = body.dealName?.trim() || null;

  if (source === "borrower") {
    const linkRes = await resolveBorrowerLink({
      sb,
      portalToken: body.portalToken ?? null,
      portalLinkId: body.portalLinkId ?? null,
    });

    if (!linkRes.ok) {
      return NextResponse.json(
        { ok: false, error: linkRes.error, requestId },
        { status: 403 },
      );
    }

    dealId = dealId || String(linkRes.link.deal_id);
    bankId = String(linkRes.link.bank_id);

    if (dealId !== String(linkRes.link.deal_id)) {
      return NextResponse.json(
        { ok: false, error: "deal_mismatch", requestId },
        { status: 409 },
      );
    }
  } else {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", requestId },
        { status: 401 },
      );
    }

    bankId = await getCurrentBankId();

    if (!dealId) {
      displayName = displayName || generateDealName();
      const bootstrap = await sb.rpc("deal_bootstrap_create", {
        p_bank_id: bankId,
        p_name: displayName,
        p_created_by: userId,
        p_source: "banker",
        p_created_by_user_id: userId,
        p_created_by_email: body.createdByEmail ?? null,
        p_created_by_name: body.createdByName ?? null,
      });

      if (bootstrap.error || !bootstrap.data?.[0]) {
        return NextResponse.json(
          { ok: false, error: bootstrap.error?.message || "bootstrap_failed", requestId },
          { status: 500 },
        );
      }

      const row = bootstrap.data[0] as { deal_id: string; session_id: string; expires_at: string };
      dealId = row.deal_id;
      sessionId = row.session_id;
      expiresAt = row.expires_at;

      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "deal.created",
        uiState: "done",
        uiMessage: "Deal created",
        meta: { deal_name: displayName },
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
    } else {
      const { data: deal, error } = await sb
        .from("deals")
        .select("id, bank_id")
        .eq("id", dealId)
        .maybeSingle();

      if (error || !deal) {
        return NextResponse.json(
          { ok: false, error: "deal_not_found", requestId },
          { status: 404 },
        );
      }

      if (deal.bank_id && String(deal.bank_id) !== String(bankId)) {
        return NextResponse.json(
          { ok: false, error: "deal_not_found", requestId },
          { status: 404 },
        );
      }
    }
  }

  if (!dealId || !bankId) {
    return NextResponse.json(
      { ok: false, error: "missing_deal", requestId },
      { status: 400 },
    );
  }

  if (!sessionId) {
    const created = await createDealUploadSession({
      sb,
      dealId,
      bankId,
      source,
      createdByName: body.createdByName ?? null,
      createdByEmail: body.createdByEmail ?? null,
    });
    sessionId = created.sessionId;
    expiresAt = created.expiresAt;
  }

  const uploads = await buildUploadSession({
    req,
    dealId,
    files: normalizedFiles,
    requestId,
    signFile: ({ req: innerReq, dealId: innerDealId, file, requestId: innerRequestId }) =>
      signDealUpload({
        req: innerReq,
        dealId: innerDealId,
        uploadSessionId: sessionId,
        filename: file.filename,
        mimeType: file.contentType || null,
        sizeBytes: file.sizeBytes,
        requestId: innerRequestId,
      }),
  });

  await Promise.all(
    uploads.map((u) =>
      upsertUploadSessionFile({
        sb,
        sessionId: sessionId as string,
        dealId: dealId as string,
        bankId: bankId as string,
        fileId: u.fileId,
        filename: u.filename,
        contentType: u.headers?.["Content-Type"] || u.headers?.["content-type"] || "application/octet-stream",
        sizeBytes: u.sizeBytes,
        objectKey: u.objectKey,
        bucket: u.bucket,
      }),
    ),
  );

  return NextResponse.json({
    ok: true,
    dealId,
    sessionId,
    displayName,
    uploadUrls: uploads.map((u) => ({
      fileId: u.fileId,
      signedUrl: u.uploadUrl,
      method: "PUT" as const,
      headers: u.headers,
      objectKey: u.objectKey,
      bucket: u.bucket,
      filename: u.filename,
      sizeBytes: u.sizeBytes,
    })),
    uploadSessionExpiresAt: expiresAt,
    redirectUrl: `/deals/${dealId}/intake`,
    requestId,
  });
}
