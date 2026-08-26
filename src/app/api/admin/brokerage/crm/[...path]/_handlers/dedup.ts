import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { findDuplicatePeople, findDuplicateOrganizations, mergePeople, mergeOrganizations } from "@/lib/crm/dedup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/crm/dedup -- one file for both the list and the
 * merge action (route-budget consolidation; see routeConsolidationGuard
 * test) rather than a separate /dedup/merge route for a single POST.
 *
 * GET  ?type=people|organizations -> suggested duplicates only, nothing
 *      ever merges automatically. Each candidate carries its confidence
 *      and the exact reasons it matched so staff can make an informed call.
 * POST { entityType, sourceId, targetId, reason? } -> explicit, audited
 *      merge -- the only way two CRM records ever become one. Source is
 *      soft-merged (merged_into_id/merged_at), never deleted; see
 *      crm_merge_log for the full audit trail and rollback snapshot.
 */
export async function GET(req: NextRequest) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const type = req.nextUrl.searchParams.get("type") ?? "people";
  if (type !== "people" && type !== "organizations") {
    return NextResponse.json({ ok: false, error: "type must be 'people' or 'organizations'" }, { status: 400 });
  }

  const brokerageBankId = await getBrokerageBankId();

  try {
    const candidates =
      type === "people"
        ? await findDuplicatePeople(brokerageBankId)
        : await findDuplicateOrganizations(brokerageBankId);
    return NextResponse.json({ ok: true, type, candidates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  const entityType = body?.entityType;
  const sourceId = body?.sourceId;
  const targetId = body?.targetId;

  if (entityType !== "person" && entityType !== "organization") {
    return NextResponse.json({ ok: false, error: "entityType must be 'person' or 'organization'" }, { status: 400 });
  }
  if (typeof sourceId !== "string" || typeof targetId !== "string" || !sourceId || !targetId) {
    return NextResponse.json({ ok: false, error: "sourceId and targetId are required" }, { status: 400 });
  }

  try {
    const mergeFn = entityType === "person" ? mergePeople : mergeOrganizations;
    await mergeFn({
      bankId: brokerageBankId,
      sourceId,
      targetId,
      mergedByClerkUserId: userId,
      reason: typeof body?.reason === "string" ? body.reason : null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
