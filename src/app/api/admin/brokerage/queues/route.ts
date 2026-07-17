import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { listManagementQueue, MANAGEMENT_QUEUES, type ManagementQueue } from "@/lib/dealStage/queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brokerage/queues?queue=overdue_tasks
 *
 * The deal-execution management queues from §5.7 (distinct from the lead
 * pipeline queues added in PR2 at /api/admin/brokerage/crm/leads?queue=).
 */
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const queue = req.nextUrl.searchParams.get("queue");
  const role = req.nextUrl.searchParams.get("role");

  if (!queue || !(MANAGEMENT_QUEUES as readonly string[]).includes(queue)) {
    return NextResponse.json({ ok: false, error: `queue is required and must be one of: ${MANAGEMENT_QUEUES.join(", ")}` }, { status: 400 });
  }

  try {
    const items = await listManagementQueue({
      bankId: brokerageBankId,
      queue: queue as ManagementQueue,
      actorClerkUserId: userId,
      actorRole: role,
    });
    return NextResponse.json({ ok: true, queue, items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
