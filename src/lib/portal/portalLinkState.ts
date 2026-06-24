import "server-only";

/**
 * Borrower portal link state helpers.
 *
 * Spec: SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.3.
 *
 * Single typed wrapper over the SECURITY DEFINER RPCs that enforce the
 * link state machine (`expires_at`, `single_use`/`used_at`, `revoked_at`).
 * Every server caller should go through here — never query
 * `borrower_portal_links` directly for state.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type PortalLinkRow = {
  deal_id: string;
  bank_id: string;
  label: string | null;
};

export type PortalLinkErrorCode =
  | "link_not_found"
  | "link_expired"
  | "link_consumed"
  | "link_revoked"
  | "portal_link_rpc_failed";

const TERMINAL_HTTP_STATUS: Record<PortalLinkErrorCode, number> = {
  link_not_found: 404,
  link_expired: 410,
  link_consumed: 410,
  link_revoked: 410,
  portal_link_rpc_failed: 500,
};

export class PortalLinkError extends Error {
  public readonly code: PortalLinkErrorCode;
  public readonly status: number;
  constructor(code: PortalLinkErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PortalLinkError";
    this.code = code;
    this.status = TERMINAL_HTTP_STATUS[code];
  }
}

function classify(rawMessage: string | null | undefined): PortalLinkErrorCode {
  const m = rawMessage?.match(/[a-z_]+/)?.[0];
  if (
    m === "link_not_found" ||
    m === "link_expired" ||
    m === "link_consumed" ||
    m === "link_revoked"
  ) {
    return m;
  }
  return "portal_link_rpc_failed";
}

/**
 * Consume a token. Marks it used (when single_use). Throws PortalLinkError
 * on any terminal state; the caller uses `err.status` for HTTP response.
 */
export async function consumeBorrowerPortalLink(
  token: string,
): Promise<PortalLinkRow> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("consume_borrower_portal_link", {
    p_token: token,
  });
  if (error) {
    throw new PortalLinkError(classify(error.message), error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.deal_id || !row?.bank_id) {
    throw new PortalLinkError("portal_link_rpc_failed", "no_row");
  }
  return {
    deal_id: row.deal_id,
    bank_id: row.bank_id,
    label: row.label ?? null,
  };
}

/**
 * Peek at a token without consuming it. Same gate as `consume`, but
 * never marks used_at. Used by file-commit handlers that must re-validate
 * the link on every request.
 */
export async function peekBorrowerPortalLink(
  token: string,
): Promise<PortalLinkRow> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("peek_borrower_portal_link", {
    p_token: token,
  });
  if (error) {
    throw new PortalLinkError(classify(error.message), error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.deal_id || !row?.bank_id) {
    throw new PortalLinkError("portal_link_rpc_failed", "no_row");
  }
  return {
    deal_id: row.deal_id,
    bank_id: row.bank_id,
    label: row.label ?? null,
  };
}

/**
 * Test-only — exported so unit tests can assert the classification
 * mapping without going through the RPC.
 */
export const __test_classify = classify;
