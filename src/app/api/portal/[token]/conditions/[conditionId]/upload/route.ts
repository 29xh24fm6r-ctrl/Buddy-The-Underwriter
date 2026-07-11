import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processConditionUpload } from "@/lib/conditions/processConditionUpload";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { validateUploadSession } from "@/lib/uploads/uploadSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ token: string; conditionId: string }>;
};

/**
 * POST /api/portal/[token]/conditions/[conditionId]/upload
 *
 * Borrower-token-authenticated condition-targeted upload.
 * Validates token, verifies condition belongs to token's deal,
 * creates document + condition intent link, triggers classification.
 *
 * Auth: borrower portal token ONLY — no Clerk dependency.
 */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { token, conditionId } = await ctx.params;
    const body = await req.json();

    const {
      file_id,
      original_filename,
      mime_type,
      size_bytes,
      sha256,
      checklist_key,
      session_id,
      upload_session_id,
    } = body;

    const headerSessionId = req.headers.get("x-buddy-upload-session-id");
    const resolvedSessionId = headerSessionId || upload_session_id || session_id || null;

    if (!file_id || !original_filename) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields: file_id, original_filename" },
        { status: 400 },
      );
    }

    if (!resolvedSessionId) {
      return NextResponse.json(
        { ok: false, error: "missing_upload_session" },
        { status: 400 },
      );
    }

    // 1. Validate borrower portal token
    const sb = supabaseAdmin();

    const { data: link, error: linkErr } = await sb
      .from("borrower_portal_links")
      .select("deal_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkErr || !link) {
      console.warn("[portal/conditions/upload] Invalid token", {
        event: "borrower_token_invalid",
        token: token.slice(0, 8) + "...",
        severity: "warn",
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json(
        { ok: false, error: "Link expired" },
        { status: 403 },
      );
    }

    const dealId = link.deal_id;

    // 2. Fetch deal bank_id
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
    }

    const bankId = deal.bank_id;

    // 3. Verify condition belongs to this deal
    // Check both condition tables for backwards compatibility
    const { data: condition } = await sb
      .from("deal_conditions")
      .select("id, title, status")
      .eq("id", conditionId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!condition) {
      // Also check legacy conditions_to_close
      const { data: legacyCondition } = await sb
        .from("conditions_to_close")
        .select("id")
        .eq("id", conditionId)
        .eq("application_id", dealId)
        .maybeSingle();

      if (!legacyCondition) {
        console.warn("[portal/conditions/upload] Condition/deal mismatch", {
          event: "borrower_upload_deal_mismatch",
          conditionId,
          dealId,
          severity: "warn",
          timestamp: new Date().toISOString(),
        });
        return NextResponse.json(
          { ok: false, error: "Condition not found for this deal" },
          { status: 404 },
        );
      }
    }

    // 4. Validate upload session and resolve the SERVER-RECORDED storage location.
    // SECURITY: never trust client-supplied storage_path/storage_bucket for the
    // write into deal_documents — always resolve object_key/bucket from the
    // deal_upload_session_files row that was created when the signed URL was
    // issued (scoped to this token's deal), matching the pattern used by
    // /api/deals/[dealId]/files/record and /api/portal/[token]/files/record.
    const sessionValidation = await validateUploadSession({
      sb,
      sessionId: resolvedSessionId,
      dealId,
      bankId,
    });

    if (!sessionValidation.ok) {
      console.warn("[portal/conditions/upload] Upload session invalid", {
        event: "borrower_upload_session_invalid",
        conditionId,
        dealId,
        reason: sessionValidation.error,
        severity: "warn",
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(
        { ok: false, error: sessionValidation.error },
        { status: 409 },
      );
    }

    const { data: sessionFile, error: sessionFileErr } = await sb
      .from("deal_upload_session_files")
      .select("id, size_bytes, status, object_key, bucket")
      .eq("session_id", resolvedSessionId)
      .eq("file_id", file_id)
      .maybeSingle();

    if (sessionFileErr || !sessionFile) {
      console.warn("[portal/conditions/upload] Upload session file missing", {
        event: "borrower_upload_session_file_missing",
        conditionId,
        dealId,
        fileId: file_id,
        severity: "warn",
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(
        { ok: false, error: "upload_session_file_missing" },
        { status: 409 },
      );
    }

    if (
      size_bytes != null &&
      Number((sessionFile as any).size_bytes || 0) !== Number(size_bytes || 0)
    ) {
      return NextResponse.json(
        { ok: false, error: "upload_session_size_mismatch" },
        { status: 409 },
      );
    }

    const serverObjectKey = (sessionFile as any).object_key as string | null;
    const serverBucket = (sessionFile as any).bucket as string | null;

    if (!serverObjectKey || !serverBucket) {
      console.error("[portal/conditions/upload] Session file missing object_key/bucket", {
        event: "borrower_upload_session_file_invalid",
        conditionId,
        dealId,
        fileId: file_id,
        severity: "error",
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(
        { ok: false, error: "upload_session_file_invalid" },
        { status: 409 },
      );
    }

    // 5. Process the upload through canonical pipeline using server-trusted values.
    const result = await processConditionUpload({
      dealId,
      bankId,
      conditionId,
      file: {
        original_filename,
        mimeType: mime_type ?? "application/octet-stream",
        sizeBytes: size_bytes ?? 0,
        storagePath: serverObjectKey,
        storageBucket: serverBucket,
        sha256: sha256 ?? null,
      },
      source: "borrower_portal",
      checklistKey: checklist_key ?? null,
    });

    if (!result.ok) {
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "condition.upload.failed",
        uiState: "done",
        uiMessage: "Condition upload failed",
        meta: {
          condition_id: conditionId,
          error: result.error,
          stage: result.stage,
          source: "borrower_portal",
        },
      }).catch(() => {});

      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      document_id: result.documentId,
      condition_id: result.conditionId,
      link_id: result.linkId,
      classification_queued: result.classificationQueued,
      condition_status: result.conditionStatus,
    });
  } catch (error: any) {
    console.error("[portal/conditions/upload] Unhandled error", {
      event: "condition_upload_failed",
      error: error?.message,
      stack: error?.stack,
      severity: "error",
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
