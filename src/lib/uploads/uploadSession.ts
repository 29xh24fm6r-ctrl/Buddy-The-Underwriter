import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type UploadSessionSource = "banker" | "borrower" | "system";

export async function createDealUploadSession(args: {
  sb?: ReturnType<typeof supabaseAdmin>;
  dealId: string;
  bankId: string;
  source: UploadSessionSource;
  createdByUserId?: string | null;
  createdByEmail?: string | null;
  createdByName?: string | null;
  portalLinkId?: string | null;
  metadata?: Record<string, unknown> | null;
  expiresMinutes?: number;
}): Promise<{ sessionId: string; expiresAt: string }> {
  const sb = args.sb ?? supabaseAdmin();
  const expiresMinutes = Math.max(5, Math.min(180, Number(args.expiresMinutes ?? 30)));
  const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("deal_upload_sessions")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      status: "ready",
      created_by: args.createdByUserId ?? null,
      created_by_user_id: args.createdByUserId ?? null,
      created_by_email: args.createdByEmail ?? null,
      created_by_name: args.createdByName ?? null,
      source: args.source,
      portal_link_id: args.portalLinkId ?? null,
      metadata: args.metadata ?? {},
    })
    .select("id, expires_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "upload_session_create_failed");
  }

  return { sessionId: String(data.id), expiresAt: String(data.expires_at) };
}

export async function validateUploadSession(args: {
  sb?: ReturnType<typeof supabaseAdmin>;
  sessionId: string;
  dealId: string;
  bankId: string;
}) {
  const sb = args.sb ?? supabaseAdmin();
  const sessionRes = await sb
    .from("deal_upload_sessions")
    .select("id, deal_id, bank_id, expires_at, status")
    .eq("id", args.sessionId)
    .maybeSingle();

  if (sessionRes.error || !sessionRes.data) {
    return { ok: false as const, error: "invalid_upload_session" };
  }

  const session = sessionRes.data as any;
  const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
  const expired = expiresAt ? Date.now() > expiresAt.getTime() : false;
  if (expired || session.status === "failed" || session.status === "completed") {
    return { ok: false as const, error: "upload_session_expired" };
  }

  if (String(session.bank_id) !== String(args.bankId)) {
    return { ok: false as const, error: "upload_session_bank_mismatch" };
  }

  if (String(session.deal_id) !== String(args.dealId)) {
    return { ok: false as const, error: "upload_session_mismatch" };
  }

  return { ok: true as const, session };
}

export async function upsertUploadSessionFile(args: {
  sb?: ReturnType<typeof supabaseAdmin>;
  sessionId: string;
  dealId: string;
  bankId: string;
  fileId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
  bucket: string;
  status?: "ready" | "completed";
}) {
  const sb = args.sb ?? supabaseAdmin();
  const status = args.status ?? "ready";
  return sb
    .from("deal_upload_session_files")
    .upsert(
      {
        session_id: args.sessionId,
        deal_id: args.dealId,
        bank_id: args.bankId,
        file_id: args.fileId,
        filename: args.filename,
        content_type: args.contentType,
        size_bytes: args.sizeBytes,
        object_key: args.objectKey,
        bucket: args.bucket,
        status,
      },
      { onConflict: "session_id,file_id", ignoreDuplicates: true },
    );
}
