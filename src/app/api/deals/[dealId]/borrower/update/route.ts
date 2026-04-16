import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  // borrowers table (verified schema — no website or dba column)
  naics_code: z.string().min(2).max(10).optional(),
  naics_description: z.string().min(2).max(300).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  legal_name: z.string().min(2).max(200).optional(),
  address_line1: z.string().max(300).optional(),
  // deal_memo_overrides (no column in borrowers)
  banker_summary: z.string().max(3000).optional(),
  website: z.string().max(500).optional(),
  dba: z.string().max(200).optional(),
  business_description: z.string().max(3000).optional(),
  revenue_mix: z.string().max(1000).optional(),
  seasonality: z.string().max(500).optional(),
  collateral_description: z.string().max(1000).optional(),
  collateral_address: z.string().max(300).optional(),
  competitive_advantages: z.string().max(1000).optional(),
  vision: z.string().max(1000).optional(),
  // deal name
  deal_name: z.string().max(200).optional(),
}).passthrough(); // allow principal_bio_* keys

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = BodySchema.parse(await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const { data: deal } = await (sb as any)
      .from("deals")
      .select("borrower_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal?.borrower_id) {
      return NextResponse.json({ ok: false, error: "no_borrower_linked" }, { status: 400 });
    }

    // Borrower table patch (only verified columns)
    const BORROWER_COLUMNS = ["naics_code", "naics_description", "city", "state", "legal_name", "address_line1"];
    const borrowerPatch: Record<string, string> = {};
    for (const col of BORROWER_COLUMNS) {
      if (body[col] !== undefined) borrowerPatch[col] = body[col] as string;
    }

    if (Object.keys(borrowerPatch).length > 0) {
      const { error } = await (sb as any)
        .from("borrowers")
        .update(borrowerPatch)
        .eq("id", deal.borrower_id);
      if (error) {
        return NextResponse.json({ ok: false, error: "update_failed", detail: error.message }, { status: 500 });
      }
    }

    // Overrides patch: everything that isn't a borrower column or deal_name
    const OVERRIDE_SKIP = new Set([...BORROWER_COLUMNS, "deal_name"]);
    const overridesPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!OVERRIDE_SKIP.has(k) && v !== undefined) {
        overridesPatch[k] = v;
      }
    }

    if (Object.keys(overridesPatch).length > 0) {
      const { data: existing } = await (sb as any)
        .from("deal_memo_overrides")
        .select("overrides")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .maybeSingle();

      const merged = { ...(existing?.overrides ?? {}), ...overridesPatch };
      await (sb as any)
        .from("deal_memo_overrides")
        .upsert(
          { deal_id: dealId, bank_id: access.bankId, overrides: merged },
          { onConflict: "deal_id,bank_id" },
        );
    }

    if (typeof body.deal_name === "string") {
      await (sb as any)
        .from("deals")
        .update({ display_name: (body.deal_name as string).trim() })
        .eq("id", dealId);
    }

    void writeEvent({
      dealId,
      kind: "deal.borrower.recovery_wizard_updated",
      actorUserId: access.userId,
      scope: "borrower",
      meta: {
        borrower_fields: Object.keys(borrowerPatch),
        override_fields: Object.keys(overridesPatch),
        renamed: body.deal_name !== undefined,
      },
    });

    return NextResponse.json({ ok: true, updated: { borrower: Object.keys(borrowerPatch), overrides: Object.keys(overridesPatch) } });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
