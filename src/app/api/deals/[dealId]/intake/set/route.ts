import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertBorrowerPhoneLink } from "@/lib/sms/phoneLinks";
import { normalizeE164 } from "@/lib/sms/phone";
import {
  buildChecklistForLoanType,
  LoanType,
} from "@/lib/deals/checklistPresets";
import { autoMatchChecklistFromFilename } from "@/lib/deals/autoMatchChecklistFromFilename";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  loanType: LoanType;
  borrowerName?: string | null;
  borrowerEmail?: string | null;
  borrowerPhone?: string | null;
  autoSeed?: boolean; // default true
};

export async function POST(
  req: Request,
  ctx: { params: { dealId: string } },
) {
  try {
    const { userId } = await auth();
    if (!userId)
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );

    const { dealId } = ctx.params;
    const body = (await req.json().catch(() => null)) as Body | null;

  const loanType = body?.loanType;
  if (!loanType)
    return NextResponse.json(
      { ok: false, error: "Missing loanType" },
      { status: 400 },
    );

  if (!["CRE", "CRE_OWNER_OCCUPIED", "CRE_INVESTOR", "CRE_OWNER_OCCUPIED_WITH_RENT", "LOC", "TERM", "SBA_7A", "SBA_504"].includes(loanType)) {
    return NextResponse.json(
      { ok: false, error: "Invalid loanType" },
      { status: 400 },
    );
  }

  const sbaProgram =
    loanType === "SBA_7A" ? "7A" : loanType === "SBA_504" ? "504" : null;

  const sb = supabaseAdmin();

  // Get deal bank_id for phone link
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal?.bank_id) {
    console.error("[/api/deals/[dealId]/intake/set] deal lookup failed", { dealId, dealErr });
    return NextResponse.json(
      { ok: false, error: "Deal not found or missing bank context" },
      { status: 400 },
    );
  }

  const { error: upErr } = await sb
    .from("deal_intake")
    .upsert(
      {
        deal_id: dealId,
        bank_id: deal.bank_id,
        loan_type: loanType,
        sba_program: sbaProgram,
        borrower_name: body?.borrowerName ?? null,
        borrower_email: body?.borrowerEmail ?? null,
        borrower_phone: body?.borrowerPhone ?? null,
      },
      { onConflict: "deal_id" },
    );

  if (upErr) {
    console.error("[/api/deals/[dealId]/intake/set]", upErr);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to set intake",
        details: upErr.message,
        hint: (upErr as any)?.hint ?? null,
        code: (upErr as any)?.code ?? null,
      },
      { status: 500 },
    );
  }

  // Create phone link if borrower phone provided
  if (body?.borrowerPhone) {
    const normalized = normalizeE164(body.borrowerPhone);
    if (normalized) {
      try {
        await upsertBorrowerPhoneLink({
          phoneE164: normalized,
          bankId: deal?.bank_id || null,
          dealId: dealId,
          source: "intake_form",
          metadata: {
            borrower_name: body?.borrowerName || null,
            borrower_email: body?.borrowerEmail || null,
          },
        });
      } catch (phoneLinkErr) {
        console.error("Phone link creation in intake error:", phoneLinkErr);
        // Don't fail request
      }
    }
  }

  const autoSeed = body?.autoSeed ?? true;
  let matchResult = { matched: 0, updated: 0 };
  
  if (autoSeed) {
    const rows = buildChecklistForLoanType(loanType).map((r) => ({
      deal_id: dealId,
      checklist_key: r.checklist_key,
      title: r.title,
      description: r.description ?? null,
      required: r.required,
    }));

    const { error: seedErr } = await supabaseAdmin()
      .from("deal_checklist_items")
      .upsert(rows, { onConflict: "deal_id,checklist_key" });

    if (seedErr) {
      console.error("[/api/deals/[dealId]/intake/set] seed error", seedErr);
      return NextResponse.json({
        ok: false,
        error: "Failed to seed checklist",
      });
    }

    // Normalize status for newly seeded rows without clobbering existing received items.
    try {
      const seededKeys = rows.map((r) => r.checklist_key);
      await sb
        .from("deal_checklist_items")
        .update({ status: "missing" })
        .eq("deal_id", dealId)
        .in("checklist_key", seededKeys)
        .is("status", null);
    } catch (e) {
      console.warn("[/api/deals/[dealId]/intake/set] status normalization failed (non-fatal):", e);
    }

    // Auto-match any previously uploaded files to the new checklist (doc_intel first; filename fallback)
    try {
      const { data: files } = await sb
        .rpc("list_deal_documents", { p_deal_id: dealId });

      if (files && files.length > 0) {
        let totalUpdated = 0;
        for (const file of files) {
          const result = await autoMatchChecklistFromFilename({
            dealId,
            filename: file.original_filename,
            fileId: file.id,
          });
          totalUpdated += result.updated;

          // Best-effort: stamp the document row with the matched checklist key
          if (!file.checklist_key && result.matched.length > 0) {
            await sb
              .from("deal_documents")
              .update({ checklist_key: result.matched[0] })
              .eq("id", file.id);
          }
        }
        matchResult = { matched: files.length, updated: totalUpdated };
      }
    } catch (matchErr) {
      console.error("Auto-match error:", matchErr);
      // Don't fail the request if matching fails
    }
  }

    // Emit intake updated event
    await writeEvent({
      dealId,
      kind: "intake.updated",
      actorUserId: userId,
      input: {
        loanType,
        borrowerName: body?.borrowerName || null,
        autoSeed,
      },
      meta: {
        sba_program: sbaProgram || null,
        checklist_seeded: autoSeed,
        auto_match_result: matchResult.updated > 0 ? matchResult : null,
      },
    });

    return NextResponse.json({ 
      ok: true, 
      matchResult: matchResult.updated > 0 ? matchResult : undefined,
      event_emitted: true,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/intake/set]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to set intake",
        details: error?.message ?? String(error),
      },
      { status: 500 },
    );
  }
}
