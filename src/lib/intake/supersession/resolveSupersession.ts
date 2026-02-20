/**
 * Phase E3 — Supersession Resolution (Server-Only)
 *
 * Given a newly classified document and its logical key, resolves
 * whether it supersedes an existing active document or is a duplicate.
 *
 * Algorithm:
 * 1. NULL logical_key → no_key (identity unresolved, fail-open)
 * 2. No existing active doc with same key → no_conflict (set key on new doc)
 * 3. Same SHA-256 + same canonical_type + same doc_year → duplicate_rejected (deactivate new doc)
 * 4. Different content → superseded (deactivate old, set key on new)
 *
 * CRITICAL ORDER for supersession: Deactivate old doc BEFORE setting
 * logical_key on new doc. Otherwise unique constraint violation.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { SUPERSESSION_VERSION } from "./computeLogicalKey";

// ── Types ──────────────────────────────────────────────────────────────

export type SupersessionResult =
  | { outcome: "no_key" }
  | { outcome: "no_conflict" }
  | { outcome: "duplicate_rejected"; existingDocId: string }
  | { outcome: "superseded"; supersededDocId: string }
  | { outcome: "error"; error: string };

// ── Main ───────────────────────────────────────────────────────────────

export async function resolveSupersession(args: {
  dealId: string;
  documentId: string;
  logicalKey: string | null;
}): Promise<SupersessionResult> {
  const { dealId, documentId, logicalKey } = args;

  // 1. No key → identity unresolved, fail-open
  if (logicalKey == null) {
    return { outcome: "no_key" };
  }

  const sb = supabaseAdmin();

  try {
    // 2. Check for existing active doc with same logical_key
    const { data: existing, error: existErr } = await (sb as any)
      .from("deal_documents")
      .select("id, sha256, canonical_type, doc_year")
      .eq("deal_id", dealId)
      .eq("logical_key", logicalKey)
      .eq("is_active", true)
      .neq("id", documentId)
      .maybeSingle();

    if (existErr) {
      return { outcome: "error", error: existErr.message };
    }

    if (!existing) {
      // No conflict — set logical_key on new doc
      await (sb as any)
        .from("deal_documents")
        .update({ logical_key: logicalKey })
        .eq("id", documentId);

      return { outcome: "no_conflict" };
    }

    // 3. Fetch new doc's SHA-256 for comparison
    const { data: newDoc, error: newDocErr } = await (sb as any)
      .from("deal_documents")
      .select("sha256, canonical_type, doc_year")
      .eq("id", documentId)
      .maybeSingle();

    if (newDocErr || !newDoc) {
      return { outcome: "error", error: newDocErr?.message ?? "new_doc_not_found" };
    }

    // 4. Duplicate detection: same SHA-256 AND same canonical_type AND same doc_year
    const isSameSha =
      newDoc.sha256 != null &&
      existing.sha256 != null &&
      newDoc.sha256 === existing.sha256;
    const isSameType = newDoc.canonical_type === existing.canonical_type;
    const isSameYear = newDoc.doc_year === existing.doc_year;

    if (isSameSha && isSameType && isSameYear) {
      // Duplicate: deactivate the NEW doc
      await (sb as any)
        .from("deal_documents")
        .update({
          is_active: false,
          logical_key: logicalKey,
        })
        .eq("id", documentId);

      void writeEvent({
        dealId,
        kind: "intake.duplicate_rejected",
        scope: "intake",
        meta: {
          document_id: documentId,
          existing_document_id: existing.id,
          logical_key: logicalKey,
          sha256: newDoc.sha256,
          supersession_version: SUPERSESSION_VERSION,
        },
      });

      return { outcome: "duplicate_rejected", existingDocId: existing.id };
    }

    // 5. Supersession: deactivate OLD, then set key on NEW
    // CRITICAL ORDER: deactivate old FIRST to avoid unique constraint violation
    await (sb as any)
      .from("deal_documents")
      .update({
        is_active: false,
        superseded_by: documentId,
      })
      .eq("id", existing.id);

    // Now safe to set logical_key on new doc
    await (sb as any)
      .from("deal_documents")
      .update({ logical_key: logicalKey })
      .eq("id", documentId);

    void writeEvent({
      dealId,
      kind: "intake.document_superseded",
      scope: "intake",
      meta: {
        document_id: documentId,
        superseded_document_id: existing.id,
        logical_key: logicalKey,
        supersession_version: SUPERSESSION_VERSION,
      },
    });

    return { outcome: "superseded", supersededDocId: existing.id };
  } catch (err: any) {
    return { outcome: "error", error: err?.message ?? "unknown" };
  }
}
