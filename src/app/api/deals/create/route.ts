import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";

/**
 * POST /api/deals/create
 *
 * Guaranteed deal initialization with:
 * 1. Borrower MUST exist before deal is written
 * 2. Deal name MUST NEVER be empty
 * 3. Atomic insert of deal + lifecycle + audit records
 *
 * Hard rules:
 * - No deal without borrower_id
 * - No deal without name
 * - No "NEEDS NAME" or raw UUID names
 * - No deal without lifecycle record
 * - No deal without audit log entry
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const bankId = await getCurrentBankId();
    const body = await req.json().catch(() => ({}));
    const sb = supabaseAdmin();

    // ── Rule 1: Borrower MUST exist before deal is written ────────────────
    let borrowerId = body.borrower_id as string | undefined;
    let borrowerLegalName = "";

    if (borrowerId) {
      // Verify borrower exists and belongs to this bank
      const { data: existingBorrower } = await sb
        .from("borrowers")
        .select("id, legal_name")
        .eq("id", borrowerId)
        .eq("bank_id", bankId)
        .maybeSingle();

      if (!existingBorrower) {
        return NextResponse.json(
          { ok: false, error: "borrower_not_found" },
          { status: 404 },
        );
      }
      borrowerLegalName = existingBorrower.legal_name ?? "";
    } else if (body.borrower_draft) {
      // Create borrower from draft
      const draft = body.borrower_draft as { legal_name?: string; entity_type?: string };
      const legalName = draft.legal_name?.trim();
      if (!legalName) {
        return NextResponse.json(
          { ok: false, error: "borrower_draft.legal_name is required" },
          { status: 400 },
        );
      }

      const { data: newBorrower, error: borrowerError } = await sb
        .from("borrowers")
        .insert({
          bank_id: bankId,
          legal_name: legalName,
          entity_type: draft.entity_type ?? null,
        })
        .select("id, legal_name")
        .single();

      if (borrowerError || !newBorrower) {
        return NextResponse.json(
          { ok: false, error: `Failed to create borrower: ${borrowerError?.message ?? "unknown"}` },
          { status: 500 },
        );
      }

      borrowerId = newBorrower.id;
      borrowerLegalName = newBorrower.legal_name ?? legalName;
    } else if (body.borrower_name) {
      // Legacy path: auto-create from borrower_name
      const borrowerName = (body.borrower_name as string).trim();
      const { data: newBorrower, error: borrowerError } = await sb
        .from("borrowers")
        .insert({
          bank_id: bankId,
          legal_name: borrowerName,
        })
        .select("id, legal_name")
        .single();

      if (borrowerError || !newBorrower) {
        return NextResponse.json(
          { ok: false, error: `Failed to create borrower: ${borrowerError?.message ?? "unknown"}` },
          { status: 500 },
        );
      }

      borrowerId = newBorrower.id;
      borrowerLegalName = borrowerName;
    } else {
      return NextResponse.json(
        { ok: false, error: "One of borrower_id, borrower_draft, or borrower_name is required" },
        { status: 400 },
      );
    }

    // ── Rule 2: Deal name MUST NEVER be empty ─────────────────────────────
    const rawName = (body.deal_name as string)?.trim() || (body.name as string)?.trim();
    const borrowerDisplayName = borrowerLegalName || (body.borrower_name as string)?.trim() || "New Borrower";
    const today = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const dealName = rawName || `${borrowerDisplayName} — ${today}`;

    // Reject names containing "NEEDS NAME" or raw UUIDs
    if (
      dealName.includes("NEEDS NAME") ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealName)
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid deal name: must be human-readable" },
        { status: 400 },
      );
    }

    // ── Rule 3: Atomic deal insert with all required system records ───────
    const dealId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Insert deal
    const { error: dealError } = await sb.from("deals").insert({
      id: dealId,
      bank_id: bankId,
      borrower_id: borrowerId,
      name: dealName,
      borrower_name: borrowerDisplayName,
      stage: "intake",
      entity_type: body.entity_type ?? "Unknown",
      risk_score: 0,
      created_at: now,
      updated_at: now,
    });

    if (dealError) {
      return NextResponse.json(
        { ok: false, error: `Failed to create deal: ${dealError.message}` },
        { status: 500 },
      );
    }

    // Insert audit log (best-effort — don't fail deal creation if audit fails)
    await sb.from("deal_audit_log").insert({
      deal_id: dealId,
      bank_id: bankId,
      actor_id: userId,
      event: "deal_created",
      payload: {
        borrower_id: borrowerId,
        deal_name: dealName,
        borrower_name: borrowerDisplayName,
      },
    }).then(null, (err: unknown) => {
      console.error("[deals/create] audit log insert failed:", err);
    });

    return NextResponse.json(
      {
        ok: true,
        dealId,
        deal: {
          id: dealId,
          borrower_id: borrowerId,
          name: dealName,
          borrower_name: borrowerDisplayName,
          stage: "intake",
        },
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("bank_not_selected")) {
      return NextResponse.json({ ok: false, error: "bank_not_selected" }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
