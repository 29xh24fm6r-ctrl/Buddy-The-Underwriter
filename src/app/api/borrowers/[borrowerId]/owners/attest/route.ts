import "server-only";

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { writeBuddySignal } from "@/buddy/server/writeBuddySignal";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
  validateUuidParam,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/borrowers/[borrowerId]/owners/attest";
const TOTAL_OWNERSHIP_THRESHOLD = 80;

export async function POST(req: NextRequest, ctx: { params: Promise<{ borrowerId: string }> }) {
  const correlationId = generateCorrelationId("boa");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const { userId } = await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { borrowerId } = await ctx.params;

    const uuidCheck = validateUuidParam(borrowerId, "borrowerId");
    if (!uuidCheck.ok) {
      return respond200(
        { ok: false, error: { code: "invalid_borrower_id", message: uuidCheck.error }, meta: { borrowerId: String(borrowerId), correlationId, ts } },
        headers,
      );
    }

    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Parse body for optional dealId (for ledger events)
    const body = await req.json().catch(() => ({} as { dealId?: string }));
    const dealId = body.dealId ?? null;

    // 1) Verify borrower exists and belongs to this bank
    const { data: borrower, error: bErr } = await sb
      .from("borrowers")
      .select("id, legal_name, bank_id")
      .eq("id", borrowerId)
      .maybeSingle();

    if (bErr || !borrower) {
      return respond200(
        { ok: false, error: { code: "borrower_not_found", message: "Borrower not found" }, meta: { borrowerId, correlationId, ts } },
        headers,
      );
    }

    if (borrower.bank_id !== bankId) {
      return respond200(
        { ok: false, error: { code: "tenant_mismatch", message: "Borrower belongs to a different bank" }, meta: { borrowerId, correlationId, ts } },
        headers,
      );
    }

    // 2) Load all owners for this borrower
    const { data: owners, error: oErr } = await sb
      .from("borrower_owners")
      .select("id, full_name, title, ownership_percent, ownership_source")
      .eq("borrower_id", borrowerId)
      .order("ownership_percent", { ascending: false });

    if (oErr) {
      return respond200(
        { ok: false, error: { code: "owners_load_failed", message: oErr.message }, meta: { borrowerId, correlationId, ts } },
        headers,
      );
    }

    const ownerList = owners ?? [];
    if (ownerList.length === 0) {
      return respond200(
        { ok: false, error: { code: "no_owners", message: "No owners on file. Add owners before attesting." }, meta: { borrowerId, correlationId, ts } },
        headers,
      );
    }

    // 3) Validate total ownership >= threshold
    const totalPct = ownerList.reduce(
      (sum: number, o: any) => sum + Number(o.ownership_percent ?? 0),
      0,
    );

    if (totalPct < TOTAL_OWNERSHIP_THRESHOLD) {
      return respond200(
        {
          ok: false,
          error: {
            code: "insufficient_ownership",
            message: `Total ownership is ${totalPct.toFixed(1)}%, must be >= ${TOTAL_OWNERSHIP_THRESHOLD}% to attest.`,
          },
          meta: { borrowerId, correlationId, ts, totalPct },
        },
        headers,
      );
    }

    // 4) Create immutable attestation snapshot
    const snapshot = {
      borrower_id: borrowerId,
      borrower_legal_name: borrower.legal_name,
      owners: ownerList.map((o: any) => ({
        id: o.id,
        full_name: o.full_name,
        title: o.title,
        ownership_percent: o.ownership_percent,
        ownership_source: o.ownership_source,
      })),
      total_ownership_pct: totalPct,
      attested_at: new Date().toISOString(),
    };

    const { data: attestation, error: aErr } = await sb
      .from("borrower_owner_attestations")
      .insert({
        borrower_id: borrowerId,
        attested_by_user_id: userId,
        snapshot,
      })
      .select("id, attested_at")
      .single();

    if (aErr) {
      return respond200(
        { ok: false, error: { code: "attestation_failed", message: aErr.message }, meta: { borrowerId, correlationId, ts } },
        headers,
      );
    }

    // 5) Emit ledger event
    if (dealId) {
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "buddy.borrower.owners_attested",
        uiState: "done",
        uiMessage: `Ownership attested: ${ownerList.length} owner(s), ${totalPct.toFixed(0)}% total`,
        meta: {
          correlationId,
          borrower_id: borrowerId,
          attestation_id: attestation?.id,
          owner_count: ownerList.length,
          total_pct: totalPct,
        },
      });
    }

    // 6) Emit buddy signal
    try {
      await writeBuddySignal({
        type: "borrower.owners.attested",
        ts: Date.now(),
        source: "borrower/owners/attest",
        dealId,
        payload: {
          borrowerId,
          attestationId: attestation?.id,
          ownerCount: ownerList.length,
          totalPct,
        },
      });
    } catch {
      // Non-critical — don't fail the request
    }

    return respond200(
      {
        ok: true,
        attestation: {
          id: attestation?.id,
          attested_at: attestation?.attested_at,
          owner_count: ownerList.length,
          total_ownership_pct: totalPct,
        },
        meta: { borrowerId, correlationId, ts },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "attestation_failed");
    return respond200(
      { ok: false, error: safe, meta: { borrowerId: "unknown", correlationId, ts } },
      headers,
    );
  }
}
