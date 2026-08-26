import { NextResponse } from "next/server";
import { resolveDealApiContext } from "@/lib/server/dealApiContext";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await params;
  const access = await resolveDealApiContext(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }

  const { data, error } = await access.sb
    .from("ai_events")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at");

  if (error) {
    console.error("[deal examiner] ledger lookup failed", {
      dealId,
      code: error.code,
    });
    return NextResponse.json(
      { ok: false, error: "examiner_fetch_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ledger: data ?? [] });
}
