import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { inferChecklistKey } from "@/lib/documents/inferChecklistKey";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";

function stableDocumentKeyFromUpload(upload: {
  storage_bucket: string | null;
  storage_path: string | null;
}) {
  const bucket = String(upload.storage_bucket || "borrower_uploads");
  const path = String(upload.storage_path || "");
  // keep stable + URL/path-friendly; avoid spaces and odd punctuation
  const raw = `borrower_upload:${bucket}/${path}`;
  return raw.replace(/[^a-z0-9_:/.-]/gi, "_");
}

async function upsertDealDocumentWithFallback(
  sb: ReturnType<typeof supabaseAdmin>,
  payload: Record<string, any>,
) {
  const attempts = [
    "deal_id,storage_bucket,storage_path",
    "deal_id,storage_path",
    "document_key",
  ];

  let lastErr: any = null;

  for (const onConflict of attempts) {
    const res = await sb
      .from("deal_documents")
      .upsert(payload as any, { onConflict } as any);

    if (!res.error) return { ok: true as const };

    const msg = String(res.error?.message || "");
    // Postgres: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
    if (msg.toLowerCase().includes("no unique") || msg.toLowerCase().includes("on conflict")) {
      lastErr = res.error;
      continue;
    }

    // Any other error is real and should surface.
    return { ok: false as const, error: res.error };
  }

  return { ok: false as const, error: lastErr };
}

/**
 * Canonical reconcile engine:
 * borrower_uploads (raw, immutable) → deal_documents (canonical) → checklist reconcile
 *
 * Idempotent: safe to run from auto-seed, buttons, and jobs.
 */
export async function reconcileUploadsForDeal(dealId: string, bankId: string) {
  const sb = supabaseAdmin();

  const { data: uploads, error: uploadsErr } = await sb
    .from("borrower_uploads")
    .select(
      "id,deal_id,bank_id,storage_bucket,storage_path,original_filename,mime_type,size_bytes",
    )
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  if (uploadsErr) {
    throw new Error(`borrower_uploads_read_failed: ${uploadsErr.message}`);
  }

  if (!uploads || uploads.length === 0) {
    return { matched: 0 };
  }

  let matched = 0;

  for (const upload of uploads as any[]) {
    if (!upload.storage_path) continue;

    const checklistKey = inferChecklistKey(String(upload.original_filename || ""));

    const payload: Record<string, any> = {
      deal_id: dealId,
      bank_id: bankId,
      storage_bucket: upload.storage_bucket || "borrower_uploads",
      storage_path: upload.storage_path,
      original_filename: upload.original_filename || null,
      mime_type: upload.mime_type || null,
      size_bytes: upload.size_bytes ?? null,
      source: "borrower",
      document_key: checklistKey || stableDocumentKeyFromUpload(upload),
      metadata: {
        reconciled_from: "borrower_uploads",
        borrower_upload_id: upload.id,
      },
    };

    // If we have a confident checklist key, stamp it now so DB triggers can mark received.
    if (checklistKey) {
      payload.checklist_key = checklistKey;
      payload.match_source = "filename";
      payload.match_reason = "inferChecklistKey";
      payload.match_confidence = 0.7;
    }

    const up = await upsertDealDocumentWithFallback(sb, payload);

    if (!up.ok) {
      // If this is a duplicate insert (unique violation), treat as idempotent success.
      const code = String((up as any).error?.code || "");
      if (code === "23505") continue;

      const msg = String((up as any).error?.message || "");
      throw new Error(`deal_documents_upsert_failed: ${msg}`);
    }

    matched += 1;
  }

  // Canonical checklist reconcile (stamps missing keys/years, triggers satisfaction)
  await reconcileChecklistForDeal({ sb, dealId });

  return { matched };
}
