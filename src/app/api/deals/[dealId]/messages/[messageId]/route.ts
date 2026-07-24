import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/deals/[dealId]/messages/[messageId]
 *
 * Delete a draft message. Moved here from
 * messages/[messageId]/send/route.ts, which mistakenly hosted this handler
 * under the /send sub-path (so DELETE requests to the URL ConditionMessagingCard
 * actually calls — .../messages/[messageId], no /send suffix — 404'd).
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; messageId: string }> },
) {
  const { dealId, messageId } = await ctx.params;

  try {
    await assertDealAccess(dealId);
  } catch (err) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }

  const supabase = supabaseAdmin();

  const { error } = await supabase
    .from("condition_messages")
    .delete()
    .eq("id", messageId)
    .eq("application_id", dealId);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
