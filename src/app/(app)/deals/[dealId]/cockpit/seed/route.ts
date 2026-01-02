import "server-only";

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildChecklistForLoanType, LoanType } from "@/lib/deals/checklistPresets";
import { autoMatchChecklistFromFilename } from "@/lib/deals/autoMatchChecklistFromFilename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function isLoanType(x: unknown): x is LoanType {
  return (
    typeof x === "string" &&
    [
      "CRE",
      "CRE_OWNER_OCCUPIED",
      "CRE_INVESTOR",
      "CRE_OWNER_OCCUPIED_WITH_RENT",
      "LOC",
      "TERM",
      "SBA_7A",
      "SBA_504",
    ].includes(x)
  );
}

/**
 * Server-side fallback for seeding checklist.
 *
 * Why: if the cockpit has a client-side hydration crash (often caused by extensions),
 * JS click handlers won't attach and "Save + Auto-Seed" appears to do nothing.
 * This route makes the action work with a plain HTML form POST.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { userId } = await auth();
  const { dealId } = await ctx.params;

  const redirectTo = new URL(`/deals/${dealId}/cockpit`, req.url);

  if (!userId) {
    redirectTo.searchParams.set("seed", "unauthorized");
    return NextResponse.redirect(redirectTo);
  }

  const fd = await req.formData().catch(() => null);
  const loanTypeRaw = fd?.get("loanType");

  if (!isLoanType(loanTypeRaw)) {
    redirectTo.searchParams.set("seed", "invalid_loan_type");
    return NextResponse.redirect(redirectTo);
  }

  const borrowerName = (fd?.get("borrowerName") ?? "")?.toString().trim() || null;
  const borrowerEmail = (fd?.get("borrowerEmail") ?? "")?.toString().trim() || null;
  const borrowerPhone = (fd?.get("borrowerPhone") ?? "")?.toString().trim() || null;

  const loanType = loanTypeRaw;
  const sbaProgram = loanType === "SBA_7A" ? "7A" : loanType === "SBA_504" ? "504" : null;

  const sb = supabaseAdmin();
  const bankId = await getCurrentBankId();

  // Tenant safety: ensure the deal belongs to the current bank.
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal || deal.bank_id !== bankId) {
    redirectTo.searchParams.set("seed", "forbidden");
    return NextResponse.redirect(redirectTo);
  }

  // 1) Persist intake
  const { error: intakeErr } = await sb
    .from("deal_intake")
    .upsert(
      {
        deal_id: dealId,
        bank_id: bankId,
        loan_type: loanType,
        sba_program: sbaProgram,
        borrower_name: borrowerName,
        borrower_email: borrowerEmail,
        borrower_phone: borrowerPhone,
      },
      { onConflict: "deal_id" },
    );

  if (intakeErr) {
    console.error("[/cockpit/seed] intake upsert failed", intakeErr);
    redirectTo.searchParams.set("seed", "intake_error");
    return NextResponse.redirect(redirectTo);
  }

  // 2) Seed checklist
  const checklistRows = buildChecklistForLoanType(loanType).map((r) => ({
    deal_id: dealId,
    checklist_key: r.checklist_key,
    title: r.title,
    description: r.description ?? null,
    required: r.required,
  }));

  const { error: seedErr } = await sb
    .from("deal_checklist_items")
    .upsert(checklistRows, { onConflict: "deal_id,checklist_key" });

  if (seedErr) {
    console.error("[/cockpit/seed] checklist upsert failed", seedErr);
    redirectTo.searchParams.set("seed", "seed_error");
    return NextResponse.redirect(redirectTo);
  }

  // 3) Normalize status if any old rows have NULL (non-fatal)
  try {
    const seededKeys = checklistRows.map((r) => r.checklist_key);
    await sb
      .from("deal_checklist_items")
      .update({ status: "missing" })
      .eq("deal_id", dealId)
      .in("checklist_key", seededKeys)
      .is("status", null);
  } catch (e) {
    console.warn("[/cockpit/seed] status normalization failed (non-fatal)", e);
  }

  // 4) Best-effort match (non-fatal)
  try {
    const { data: files } = await sb.rpc("list_deal_documents", { p_deal_id: dealId });
    if (files && Array.isArray(files)) {
      for (const f of files) {
        const result = await autoMatchChecklistFromFilename({
          dealId,
          filename: f.original_filename,
          fileId: f.id,
        });
        if (!f.checklist_key && result.matched.length > 0) {
          await sb.from("deal_documents").update({ checklist_key: result.matched[0] }).eq("id", f.id);
        }
      }
    }
  } catch (e) {
    console.warn("[/cockpit/seed] auto-match failed (non-fatal)", e);
  }

  // 5) Log ledger (non-fatal)
  try {
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: bankId,
      stage: "auto_seeded",
      status: "ok",
      payload: { source: "cockpit_form" },
    });
  } catch (e) {
    console.warn("[/cockpit/seed] ledger insert failed (non-fatal)", e);
  }

  redirectTo.searchParams.set("seed", "ok");
  return NextResponse.redirect(redirectTo);
}
