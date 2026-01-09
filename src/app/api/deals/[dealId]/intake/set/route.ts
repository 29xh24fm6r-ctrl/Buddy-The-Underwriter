import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertBorrowerPhoneLink } from "@/lib/sms/phoneLinks";
import { normalizeE164 } from "@/lib/sms/phone";
import {
  buildChecklistForLoanType,
  LoanType,
} from "@/lib/deals/checklistPresets";
import { autoMatchChecklistFromFilename } from "@/lib/deals/autoMatchChecklistFromFilename";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { ensureDealHasBank } from "@/lib/banks/ensureDealHasBank";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function getRequestId(req: Request) {
  return (
    req.headers.get("x-request-id") ||
    req.headers.get("x-buddy-request-id") ||
    crypto.randomUUID()
  );
}

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms),
    ),
  ]);
}

type Body = {
  loanType: LoanType;
  borrowerName?: string | null;
  borrowerEmail?: string | null;
  borrowerPhone?: string | null;
  autoSeed?: boolean; // default true
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const requestId = getRequestId(req);
  try {
    const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
    if (!userId)
      return NextResponse.json(
        { ok: false, error: "Unauthorized", requestId },
        { status: 401 },
      );

    const { dealId } = await ctx.params;
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

  // Ensure deal has bank context (assign default bank if missing)
  let bankId: string;
  try {
    const ensured = await withTimeout(
      ensureDealHasBank({ supabase: sb, dealId }),
      10_000,
      "ensureDealHasBank",
    );
    bankId = ensured.bankId;
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/intake/set] ensureDealHasBank failed", e);
    return NextResponse.json(
      {
        ok: false,
        error: "Deal not found or missing bank context",
        details: e?.message ?? String(e),
        requestId,
      },
      { status: 400 },
    );
  }

  const { error: upErr } = await withTimeout(
    sb
      .from("deal_intake")
      .upsert(
        {
          deal_id: dealId,
          bank_id: bankId,
          loan_type: loanType,
          sba_program: sbaProgram,
          borrower_name: body?.borrowerName ?? null,
          borrower_email: body?.borrowerEmail ?? null,
          borrower_phone: body?.borrowerPhone ?? null,
        },
        { onConflict: "deal_id" },
      ),
    12_000,
    "upsert_deal_intake",
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
        requestId,
      },
      { status: 500 },
    );
  }

  // Create phone link if borrower phone provided
  if (body?.borrowerPhone) {
    const normalized = normalizeE164(body.borrowerPhone);
    if (normalized) {
      try {
        await withTimeout(
          upsertBorrowerPhoneLink({
            phoneE164: normalized,
            bankId,
            dealId: dealId,
            source: "intake_form",
            metadata: {
              borrower_name: body?.borrowerName || null,
              borrower_email: body?.borrowerEmail || null,
            },
          }),
          6_000,
          "upsertBorrowerPhoneLink",
        );
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

    const { error: seedErr } = await withTimeout(
      supabaseAdmin()
        .from("deal_checklist_items")
        .upsert(rows, { onConflict: "deal_id,checklist_key" }),
      15_000,
      "seed_checklist_upsert",
    );

    if (seedErr) {
      console.error("[/api/deals/[dealId]/intake/set] seed error", seedErr);
      return NextResponse.json({
        ok: false,
        error: "Failed to seed checklist",
        requestId,
      });
    }

    // Normalize status for newly seeded rows without clobbering existing received items.
    try {
      const seededKeys = rows.map((r) => r.checklist_key);
      await withTimeout(
        sb
          .from("deal_checklist_items")
          .update({ status: "missing" })
          .eq("deal_id", dealId)
          .in("checklist_key", seededKeys)
          .is("status", null),
        10_000,
        "seed_status_normalization",
      );
    } catch (e) {
      console.warn("[/api/deals/[dealId]/intake/set] status normalization failed (non-fatal):", e);
    }

    // Auto-match any previously uploaded files to the new checklist (doc_intel first; filename fallback)
    try {
      const { data: files } = await withTimeout(
        sb.rpc("list_deal_documents", { p_deal_id: dealId }) as any,
        15_000,
        "list_deal_documents",
      );

      const startMs = Date.now();
      const budgetMs = 20_000;

      if (files && files.length > 0) {
        let totalUpdated = 0;
        for (const file of files) {
          if (Date.now() - startMs > budgetMs) break;
          const result = await autoMatchChecklistFromFilename({
            dealId,
            filename: file.original_filename,
            fileId: file.id,
          });
          totalUpdated += result.updated;

          // Best-effort: stamp the document row with the matched checklist key
          if (!file.checklist_key && result.matched.length > 0) {
            await withTimeout(
              sb
                .from("deal_documents")
                .update({ checklist_key: result.matched[0] })
                .eq("id", file.id),
              10_000,
              "stamp_deal_documents_checklist_key",
            );
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
    await withTimeout(
      writeEvent({
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
      }),
      6_000,
      "writeEvent",
    ).catch((e) => {
      console.warn("[/api/deals/[dealId]/intake/set] writeEvent failed (non-fatal):", e);
    });

    return NextResponse.json({ 
      ok: true, 
      requestId,
      matchResult: matchResult.updated > 0 ? matchResult : undefined,
      event_emitted: true,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/intake/set]", error);

    const msg = error?.message ?? String(error);
    const status = String(msg).startsWith("timeout:") ? 504 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to set intake",
        details: msg,
        requestId,
      },
      { status },
    );
  }
}
