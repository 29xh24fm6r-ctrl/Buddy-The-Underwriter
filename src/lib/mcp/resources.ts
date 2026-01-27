/**
 * Buddy MCP Resource Handlers.
 *
 * Read-only views into Buddy's operational data, exposed as buddy:// resources.
 * All handlers return { ok, data } or { ok: false, error } — never throw.
 *
 * Resources:
 *   buddy://case/{caseId}            → Full case summary
 *   buddy://case/{caseId}/documents  → Document manifest (no bytes)
 *   buddy://case/{caseId}/signals    → Signal ledger for case
 *   buddy://workflows/recent         → Recent active cases
 *
 * Server-only. Tenant-isolated via bank_id.
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { maskEin } from "@/lib/omega/redaction";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpResourceResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface BuddyCaseSummary {
  caseId: string;
  borrowerName: string | null;
  borrowerEntityType: string | null;
  einMasked: string | null;
  bankCode: string | null;
  bankName: string | null;
  lifecycleStage: string | null;
  createdAt: string | null;
  documentCount: number;
  signalCount: number;
}

export interface BuddyDocumentEntry {
  id: string;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checklistKey: string | null;
  documentType: string | null;
  source: string | null;
  createdAt: string | null;
  sha256: string | null;
}

export interface BuddySignalEntry {
  id: string;
  type: string;
  source: string | null;
  createdAt: string | null;
  payload: Record<string, unknown> | null;
}

export interface BuddyWorkflowEntry {
  caseId: string;
  borrowerName: string | null;
  bankCode: string | null;
  lifecycleStage: string | null;
  createdAt: string | null;
  lastSignalAt: string | null;
}

// ---------------------------------------------------------------------------
// buddy://case/{caseId}
// ---------------------------------------------------------------------------

export async function handleCaseResource(
  caseId: string,
  bankId: string,
): Promise<McpResourceResult<BuddyCaseSummary>> {
  try {
    const sb = supabaseAdmin();

    // Fetch deal with bank join
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, borrower_id, borrower_name, status, created_at, bank:banks(id, code, name)")
      .eq("id", caseId)
      .eq("bank_id", bankId)
      .maybeSingle();

    if (dealErr || !deal) {
      return { ok: false, error: dealErr?.message ?? "case_not_found" };
    }

    // Fetch borrower for entity type + EIN
    let einMasked: string | null = null;
    let entityType: string | null = null;
    if (deal.borrower_id) {
      const { data: borrower } = await sb
        .from("borrowers")
        .select("entity_type, ein")
        .eq("id", deal.borrower_id)
        .eq("bank_id", bankId)
        .maybeSingle();
      if (borrower) {
        entityType = borrower.entity_type ?? null;
        einMasked = borrower.ein ? maskEin(borrower.ein) : null;
      }
    }

    // Count documents
    const { count: docCount } = await sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", caseId)
      .eq("bank_id", bankId);

    // Count signals
    const { count: sigCount } = await sb
      .from("buddy_signal_ledger")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", caseId)
      .eq("bank_id", bankId);

    const bankRaw = deal.bank as unknown;
    const bank = Array.isArray(bankRaw) ? bankRaw[0] as { id: string; code: string; name: string } | undefined : bankRaw as { id: string; code: string; name: string } | null;

    return {
      ok: true,
      data: {
        caseId: deal.id,
        borrowerName: deal.borrower_name ?? null,
        borrowerEntityType: entityType,
        einMasked,
        bankCode: bank?.code ?? null,
        bankName: bank?.name ?? null,
        lifecycleStage: deal.status ?? null,
        createdAt: deal.created_at ?? null,
        documentCount: docCount ?? 0,
        signalCount: sigCount ?? 0,
      },
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "case_resource_failed" };
  }
}

// ---------------------------------------------------------------------------
// buddy://case/{caseId}/documents
// ---------------------------------------------------------------------------

export async function handleCaseDocumentsResource(
  caseId: string,
  bankId: string,
): Promise<McpResourceResult<BuddyDocumentEntry[]>> {
  try {
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("deal_documents")
      .select(
        "id, original_filename, mime_type, size_bytes, " +
        "checklist_key, document_type, source, created_at, sha256",
      )
      .eq("deal_id", caseId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return { ok: false, error: error.message };
    }

    const docs: BuddyDocumentEntry[] = (data ?? []).map((d: any) => ({
      id: String(d.id ?? ""),
      originalFilename: (d.original_filename as string) ?? null,
      mimeType: (d.mime_type as string) ?? null,
      sizeBytes: typeof d.size_bytes === "number" ? d.size_bytes : null,
      checklistKey: (d.checklist_key as string) ?? null,
      documentType: (d.document_type as string) ?? null,
      source: (d.source as string) ?? null,
      createdAt: (d.created_at as string) ?? null,
      sha256: (d.sha256 as string) ?? null,
    }));

    return { ok: true, data: docs };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "documents_resource_failed" };
  }
}

// ---------------------------------------------------------------------------
// buddy://case/{caseId}/signals
// ---------------------------------------------------------------------------

export async function handleCaseSignalsResource(
  caseId: string,
  bankId: string,
  opts?: { limit?: number; since?: string },
): Promise<McpResourceResult<BuddySignalEntry[]>> {
  try {
    const sb = supabaseAdmin();
    const limit = opts?.limit ?? 100;

    let q = sb
      .from("buddy_signal_ledger")
      .select("id, type, source, created_at, payload")
      .eq("deal_id", caseId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (opts?.since) {
      q = q.gte("created_at", opts.since);
    }

    const { data, error } = await q;

    if (error) {
      return { ok: false, error: error.message };
    }

    const signals: BuddySignalEntry[] = (data ?? []).map((s: Record<string, unknown>) => ({
      id: String(s.id ?? ""),
      type: String(s.type ?? ""),
      source: (s.source as string) ?? null,
      createdAt: (s.created_at as string) ?? null,
      payload: (s.payload as Record<string, unknown>) ?? null,
    }));

    return { ok: true, data: signals };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "signals_resource_failed" };
  }
}

// ---------------------------------------------------------------------------
// buddy://workflows/recent
// ---------------------------------------------------------------------------

export async function handleWorkflowsRecentResource(
  bankId: string,
  opts?: { limit?: number },
): Promise<McpResourceResult<BuddyWorkflowEntry[]>> {
  try {
    const sb = supabaseAdmin();
    const limit = opts?.limit ?? 25;

    const { data, error } = await sb
      .from("deals")
      .select("id, borrower_name, status, created_at, bank:banks(code)")
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { ok: false, error: error.message };
    }

    // For each deal, find latest signal timestamp
    const workflows: BuddyWorkflowEntry[] = [];
    for (const deal of data ?? []) {
      const bankRaw = deal.bank as unknown;
      const bank = Array.isArray(bankRaw) ? bankRaw[0] as { code: string } | undefined : bankRaw as { code: string } | null;
      const { data: lastSig } = await sb
        .from("buddy_signal_ledger")
        .select("created_at")
        .eq("deal_id", deal.id)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      workflows.push({
        caseId: deal.id,
        borrowerName: deal.borrower_name ?? null,
        bankCode: bank?.code ?? null,
        lifecycleStage: deal.status ?? null,
        createdAt: deal.created_at ?? null,
        lastSignalAt: lastSig?.created_at ?? null,
      });
    }

    return { ok: true, data: workflows };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "workflows_resource_failed" };
  }
}
