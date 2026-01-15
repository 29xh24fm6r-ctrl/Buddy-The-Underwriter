import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyBestPackToDeal } from "@/lib/packs/applyPack";
import { recordLearningEvent } from "@/lib/packs/recordLearningEvent";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "unauthorized" ? 401 : 404;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    // Apply pack (manuallyApplied = true since banker clicked button)
    const result = await applyBestPackToDeal(sb, dealId, {
      manuallyApplied: true,
    });

    // ✅ Record canonical pack application event
    if (result.chosenPackId) {
      const appIns = await sb
        .from("borrower_pack_applications")
        .insert({
          bank_id: result.bankId,
          deal_id: dealId,
          pack_id: result.chosenPackId,
          applied_by: "banker", // could be user ID if you have auth context
          manually_applied: true,
          metadata: {
            created_requests: result.createdRequests,
            existing_requests: result.existingRequests,
          },
        })
        .select("id")
        .single();

      // ✅ Record learning event for manual application
      if (result.matchEventId) {
        await recordLearningEvent(sb, {
          bankId: result.bankId,
          matchEventId: result.matchEventId,
          eventType: "auto_applied",
          metadata: {
            pack_id: result.chosenPackId,
            manually_applied: true,
            created_requests: result.createdRequests,
          },
        });
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "apply_failed" },
      { status: 400 },
    );
  }
}
