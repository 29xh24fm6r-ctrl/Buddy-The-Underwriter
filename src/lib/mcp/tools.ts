/**
 * Buddy MCP Tool Handlers.
 *
 * Governed tools that Omega Prime (or other MCP clients) can invoke to
 * trigger side-effects in Buddy.
 *
 * Tools:
 *   buddy_replay_case     → Re-emit all signals for a case to Omega (re-sync)
 *   buddy_validate_case   → Run validation checks on a case (read-only)
 *   buddy_generate_missing_docs_email → Generate an email draft listing missing docs
 *
 * All tools:
 * - Are server-only
 * - Return { ok, data } or { ok: false, error }
 * - Never throw
 * - Are tenant-isolated via bank_id
 * - Require explicit caseId
 *
 * Server-only.
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ReplayCaseResult {
  caseId: string;
  signalsReplayed: number;
  status: "completed" | "partial" | "failed";
  errors: string[];
}

export interface ValidateCaseResult {
  caseId: string;
  valid: boolean;
  checks: Array<{
    check: string;
    passed: boolean;
    detail: string;
  }>;
}

export interface MissingDocsEmailResult {
  caseId: string;
  borrowerName: string | null;
  missingDocuments: string[];
  emailDraft: string;
}

// ---------------------------------------------------------------------------
// buddy_replay_case
// ---------------------------------------------------------------------------

/**
 * Re-emit all signals for a case to Omega via the mirror path.
 * Useful for replaying history after Omega comes online or after data corrections.
 *
 * Does NOT modify any Buddy data. Reads signals from ledger and re-fires
 * mirrorEventToOmega for each.
 */
export async function handleReplayCase(
  caseId: string,
  bankId: string,
): Promise<McpToolResult<ReplayCaseResult>> {
  try {
    const sb = supabaseAdmin();

    // Verify deal exists for this bank
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id")
      .eq("id", caseId)
      .eq("bank_id", bankId)
      .maybeSingle();

    if (dealErr || !deal) {
      return { ok: false, error: dealErr?.message ?? "case_not_found" };
    }

    // Read all signals in chronological order
    const { data: signals, error: sigErr } = await sb
      .from("buddy_signal_ledger")
      .select("id, type, source, payload, created_at")
      .eq("deal_id", caseId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (sigErr) {
      return { ok: false, error: sigErr.message };
    }

    if (!signals || signals.length === 0) {
      return {
        ok: true,
        data: { caseId, signalsReplayed: 0, status: "completed", errors: [] },
      };
    }

    // Dynamically import mirrorEventToOmega to avoid circular deps
    const { mirrorEventToOmega } = await import("@/lib/omega/mirrorEventToOmega");

    let replayed = 0;
    const errors: string[] = [];

    for (const sig of signals) {
      try {
        const correlationId = `replay-${caseId.slice(0, 8)}-${Date.now().toString(36)}`;
        await mirrorEventToOmega({
          buddyEventType: sig.type,
          payload: {
            ...(sig.payload ?? {}),
            dealId: caseId,
            _replay: true,
            _originalTs: sig.created_at,
          },
          correlationId,
        });
        replayed++;
      } catch (err: unknown) {
        errors.push(
          `signal ${sig.id}: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    }

    return {
      ok: true,
      data: {
        caseId,
        signalsReplayed: replayed,
        status: errors.length === 0 ? "completed" : replayed > 0 ? "partial" : "failed",
        errors,
      },
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "replay_failed" };
  }
}

// ---------------------------------------------------------------------------
// buddy_validate_case
// ---------------------------------------------------------------------------

/**
 * Run read-only validation checks on a case.
 * Returns structured check results — does NOT modify any data.
 */
export async function handleValidateCase(
  caseId: string,
  bankId: string,
): Promise<McpToolResult<ValidateCaseResult>> {
  try {
    const sb = supabaseAdmin();

    const checks: ValidateCaseResult["checks"] = [];

    // Check 1: Deal exists
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, borrower_id, borrower_name, status, created_at")
      .eq("id", caseId)
      .eq("bank_id", bankId)
      .maybeSingle();

    checks.push({
      check: "deal_exists",
      passed: !!deal && !dealErr,
      detail: deal ? `Deal ${deal.id} found` : dealErr?.message ?? "Deal not found",
    });

    if (!deal) {
      return {
        ok: true,
        data: { caseId, valid: false, checks },
      };
    }

    // Check 2: Borrower linked
    checks.push({
      check: "borrower_linked",
      passed: !!deal.borrower_id,
      detail: deal.borrower_id ? `Borrower ${deal.borrower_id}` : "No borrower linked",
    });

    // Check 3: Has documents
    const { count: docCount } = await sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", caseId)
      .eq("bank_id", bankId);

    checks.push({
      check: "has_documents",
      passed: (docCount ?? 0) > 0,
      detail: `${docCount ?? 0} document(s)`,
    });

    // Check 4: Has signals
    const { count: sigCount } = await sb
      .from("buddy_signal_ledger")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", caseId)
      .eq("bank_id", bankId);

    checks.push({
      check: "has_signals",
      passed: (sigCount ?? 0) > 0,
      detail: `${sigCount ?? 0} signal(s)`,
    });

    // Check 5: Lifecycle stage valid
    const validStages = ["created", "intake", "collecting", "underwriting", "ready"];
    checks.push({
      check: "lifecycle_valid",
      passed: validStages.includes(deal.status ?? ""),
      detail: `Stage: ${deal.status ?? "null"}`,
    });

    // Check 6: Borrower attestation exists (if borrower linked)
    if (deal.borrower_id) {
      const { data: attestation } = await sb
        .from("borrower_owner_attestations")
        .select("id")
        .eq("borrower_id", deal.borrower_id)
        .limit(1)
        .maybeSingle();

      checks.push({
        check: "borrower_attested",
        passed: !!attestation,
        detail: attestation ? "Attestation found" : "No attestation",
      });
    }

    const allPassed = checks.every((c) => c.passed);

    return {
      ok: true,
      data: { caseId, valid: allPassed, checks },
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "validate_failed" };
  }
}

// ---------------------------------------------------------------------------
// buddy_generate_missing_docs_email
// ---------------------------------------------------------------------------

/**
 * Generate an email draft listing missing documents for a case.
 *
 * Reads the deal checklist configuration vs uploaded documents to determine
 * what's missing, then produces a plain-text email draft.
 *
 * Does NOT send any email. Returns the draft for review.
 */
export async function handleGenerateMissingDocsEmail(
  caseId: string,
  bankId: string,
): Promise<McpToolResult<MissingDocsEmailResult>> {
  try {
    const sb = supabaseAdmin();

    // Fetch deal
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, borrower_name, borrower_id")
      .eq("id", caseId)
      .eq("bank_id", bankId)
      .maybeSingle();

    if (dealErr || !deal) {
      return { ok: false, error: dealErr?.message ?? "case_not_found" };
    }

    // Fetch uploaded documents
    const { data: docs } = await sb
      .from("deal_documents")
      .select("checklist_key")
      .eq("deal_id", caseId)
      .eq("bank_id", bankId);

    const uploadedKeys = new Set((docs ?? []).map((d: Record<string, unknown>) => d.checklist_key).filter(Boolean));

    // Standard SBA checklist items
    const requiredDocs = [
      { key: "tax_return_business_1", label: "Business Tax Return (most recent year)" },
      { key: "tax_return_business_2", label: "Business Tax Return (prior year)" },
      { key: "tax_return_personal_1", label: "Personal Tax Return (most recent year)" },
      { key: "tax_return_personal_2", label: "Personal Tax Return (prior year)" },
      { key: "profit_loss_ytd", label: "Year-to-Date Profit & Loss Statement" },
      { key: "balance_sheet", label: "Balance Sheet" },
      { key: "debt_schedule", label: "Business Debt Schedule" },
      { key: "rent_roll", label: "Rent Roll" },
      { key: "personal_financial_statement", label: "Personal Financial Statement (SBA Form 413)" },
      { key: "drivers_license", label: "Government-Issued Photo ID" },
    ];

    const missing = requiredDocs.filter((r) => !uploadedKeys.has(r.key));
    const missingLabels = missing.map((m) => m.label);

    const borrowerName = deal.borrower_name ?? "Borrower";

    let emailDraft: string;
    if (missing.length === 0) {
      emailDraft = [
        `Subject: Document Collection Complete — ${borrowerName}`,
        "",
        `Dear ${borrowerName},`,
        "",
        "Thank you! We have received all required documents for your application.",
        "Our team will proceed with the underwriting review.",
        "",
        "Best regards,",
        "Buddy Underwriting Team",
      ].join("\n");
    } else {
      emailDraft = [
        `Subject: Action Required — Missing Documents for ${borrowerName}`,
        "",
        `Dear ${borrowerName},`,
        "",
        "Thank you for your application. To proceed with underwriting, we still need the following documents:",
        "",
        ...missingLabels.map((label, i) => `  ${i + 1}. ${label}`),
        "",
        "Please upload these documents at your earliest convenience through the secure portal.",
        "",
        "Best regards,",
        "Buddy Underwriting Team",
      ].join("\n");
    }

    return {
      ok: true,
      data: {
        caseId,
        borrowerName: deal.borrower_name ?? null,
        missingDocuments: missingLabels,
        emailDraft,
      },
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "email_gen_failed" };
  }
}
