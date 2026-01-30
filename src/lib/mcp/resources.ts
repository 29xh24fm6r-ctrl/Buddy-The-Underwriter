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

export interface LedgerSummary {
  totalEvents: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  errorCount24h: number;
  mismatchCount24h: number;
  windowStart: string;
  windowEnd: string;
}

export interface LedgerEventEntry {
  id: string;
  source: string;
  eventType: string;
  eventCategory: string;
  severity: string;
  dealId: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  payload: Record<string, unknown>;
  traceId: string | null;
  isMismatch: boolean;
  createdAt: string;
}

export interface LedgerQueryOpts {
  limit?: number;
  since?: string;
  until?: string;
  eventCategory?: string;
  severity?: string;
  eventType?: string;
  dealId?: string;
  source?: string;
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

// ---------------------------------------------------------------------------
// buddy://ledger/summary
// ---------------------------------------------------------------------------

const MAX_LEDGER_LIMIT = 200;

/**
 * Aggregate stats from the canonical observability ledger.
 * Defaults to a 24-hour window, clamped to 7 days max.
 */
export async function handleLedgerSummaryResource(
  bankId: string,
  opts?: { since?: string; until?: string },
): Promise<McpResourceResult<LedgerSummary>> {
  try {
    const sb = supabaseAdmin();

    const now = new Date();
    const windowEnd = opts?.until ?? now.toISOString();

    const defaultSince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const minSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let windowStart = opts?.since ?? defaultSince;
    if (windowStart < minSince) windowStart = minSince;

    const { data, error } = await sb
      .from("buddy_ledger_events")
      .select("event_category, severity, is_mismatch")
      .eq("bank_id", bankId)
      .gte("created_at", windowStart)
      .lte("created_at", windowEnd);

    if (error) {
      return { ok: false, error: error.message };
    }

    const rows = data ?? [];
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let errorCount = 0;
    let mismatchCount = 0;

    for (const r of rows) {
      const cat = (r as Record<string, unknown>).event_category as string;
      const sev = (r as Record<string, unknown>).severity as string;
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
      if (sev === "error" || sev === "critical") errorCount++;
      if ((r as Record<string, unknown>).is_mismatch) mismatchCount++;
    }

    return {
      ok: true,
      data: {
        totalEvents: rows.length,
        byCategory,
        bySeverity,
        errorCount24h: errorCount,
        mismatchCount24h: mismatchCount,
        windowStart,
        windowEnd,
      },
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "ledger_summary_failed" };
  }
}

// ---------------------------------------------------------------------------
// buddy://ledger/query
// ---------------------------------------------------------------------------

/**
 * Filtered query into the canonical ledger.
 * Supports time window, category, severity, event_type, source, and deal_id filters.
 * Default window: last 24 hours. Max limit: 200.
 */
export async function handleLedgerQueryResource(
  bankId: string,
  opts?: LedgerQueryOpts,
): Promise<McpResourceResult<LedgerEventEntry[]>> {
  try {
    const sb = supabaseAdmin();

    const limit = Math.min(opts?.limit ?? 50, MAX_LEDGER_LIMIT);
    const now = new Date();
    const since = opts?.since ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    let q = sb
      .from("buddy_ledger_events")
      .select(
        "id, source, event_type, event_category, severity, " +
        "deal_id, actor_user_id, actor_role, payload, trace_id, " +
        "is_mismatch, created_at",
      )
      .eq("bank_id", bankId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (opts?.until) q = q.lte("created_at", opts.until);
    if (opts?.eventCategory) q = q.eq("event_category", opts.eventCategory);
    if (opts?.severity) q = q.eq("severity", opts.severity);
    if (opts?.eventType) q = q.eq("event_type", opts.eventType);
    if (opts?.dealId) q = q.eq("deal_id", opts.dealId);
    if (opts?.source) q = q.eq("source", opts.source);

    const { data, error } = await q;

    if (error) {
      return { ok: false, error: error.message };
    }

    const events: LedgerEventEntry[] = (data ?? []).map((e: any) => ({
      id: String(e.id ?? ""),
      source: String(e.source ?? ""),
      eventType: String(e.event_type ?? ""),
      eventCategory: String(e.event_category ?? ""),
      severity: String(e.severity ?? ""),
      dealId: (e.deal_id as string) ?? null,
      actorUserId: (e.actor_user_id as string) ?? null,
      actorRole: (e.actor_role as string) ?? null,
      payload: (e.payload as Record<string, unknown>) ?? {},
      traceId: (e.trace_id as string) ?? null,
      isMismatch: Boolean(e.is_mismatch),
      createdAt: String(e.created_at ?? ""),
    }));

    return { ok: true, data: events };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "ledger_query_failed" };
  }
}

// ---------------------------------------------------------------------------
// buddy://case/{caseId}/ledger
// ---------------------------------------------------------------------------

/**
 * Deal-specific timeline from the canonical ledger.
 * Returns all events for a specific deal, newest first.
 */
export async function handleCaseLedgerResource(
  caseId: string,
  bankId: string,
  opts?: { limit?: number; since?: string },
): Promise<McpResourceResult<LedgerEventEntry[]>> {
  try {
    const sb = supabaseAdmin();

    const limit = Math.min(opts?.limit ?? 100, MAX_LEDGER_LIMIT);

    let q = sb
      .from("buddy_ledger_events")
      .select(
        "id, source, event_type, event_category, severity, " +
        "deal_id, actor_user_id, actor_role, payload, trace_id, " +
        "is_mismatch, created_at",
      )
      .eq("deal_id", caseId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (opts?.since) q = q.gte("created_at", opts.since);

    const { data, error } = await q;

    if (error) {
      return { ok: false, error: error.message };
    }

    const events: LedgerEventEntry[] = (data ?? []).map((e: any) => ({
      id: String(e.id ?? ""),
      source: String(e.source ?? ""),
      eventType: String(e.event_type ?? ""),
      eventCategory: String(e.event_category ?? ""),
      severity: String(e.severity ?? ""),
      dealId: (e.deal_id as string) ?? null,
      actorUserId: (e.actor_user_id as string) ?? null,
      actorRole: (e.actor_role as string) ?? null,
      payload: (e.payload as Record<string, unknown>) ?? {},
      traceId: (e.trace_id as string) ?? null,
      isMismatch: Boolean(e.is_mismatch),
      createdAt: String(e.created_at ?? ""),
    }));

    return { ok: true, data: events };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "case_ledger_failed" };
  }
}
