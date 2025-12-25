import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = "missing" | "received" | "waived";
type Body = { checklistKey: string; status: Status };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );

  const { dealId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Body | null;

  const checklistKey = (body?.checklistKey || "").trim();
  const status = body?.status;

  if (!checklistKey || !status) {
    return NextResponse.json(
      { ok: false, error: "Missing checklistKey/status" },
      { status: 400 },
    );
  }
  if (!["missing", "received", "waived"].includes(status)) {
    return NextResponse.json(
      { ok: false, error: "Invalid status" },
      { status: 400 },
    );
  }

  const patch: any = { status };
  if (status === "received") patch.received_at = new Date().toISOString();
  if (status !== "received") {
    patch.received_at = null;
    patch.received_file_id = null;
  }

  const { error } = await supabaseAdmin()
    .from("deal_checklist_items")
    .update(patch)
    .eq("deal_id", dealId)
    .eq("checklist_key", checklistKey);

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true });
}
