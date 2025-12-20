// src/app/api/banker/deals/[dealId]/portal-checklist/route.ts
import { NextResponse } from "next/server";
import { listChecklist } from "@/lib/portal/checklist";
import { listBorrowerReceipts } from "@/lib/portal/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    requireUserId(req);
    const { dealId } = await ctx.params;

    const [checklist, receipts] = await Promise.all([listChecklist(dealId), listBorrowerReceipts(dealId)]);

    const rows = checklist ?? [];
    const required = rows.filter((r: any) => r.item?.required);
    const missing = required.filter((r: any) => r.state?.status === "missing");
    const completed = required.filter((r: any) => r.state?.status !== "missing");

    return NextResponse.json({
      ok: true,
      checklist: rows.map((r: any) => ({
        id: r.item.id,
        code: r.item.code,
        title: r.item.title,
        description: r.item.description,
        group: r.item.group_name,
        required: r.item.required,
        status: r.state.status,
        completedAt: r.state.completed_at,
      })),
      receipts,
      stats: {
        requiredTotal: required.length,
        requiredDone: completed.length,
        requiredMissing: missing.length,
        percent: required.length ? Math.round((completed.length / required.length) * 100) : 100,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
