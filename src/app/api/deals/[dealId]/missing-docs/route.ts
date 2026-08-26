import { NextResponse } from "next/server";
import { resolveDealApiContext } from "@/lib/server/dealApiContext";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const access = await resolveDealApiContext(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }

  const { data, error } = await access.sb
    .from("deal_missing_docs")
    .select("key,label,severity,reason,status,updated_at")
    .eq("deal_id", dealId)
    .order("severity", { ascending: true });

  if (error) {
    console.error("[missing docs] lookup failed", { dealId, code: error.code });
    return NextResponse.json(
      { ok: false, error: "missing_docs_get_failed" },
      { status: 500 },
    );
  }

  const missing = (data ?? [])
    .filter((row) => row.status === "missing")
    .map((row) => ({
      key: row.key,
      label: row.label,
      severity: row.severity,
      reason: row.reason,
    }));

  return NextResponse.json({ ok: true, missing });
}
