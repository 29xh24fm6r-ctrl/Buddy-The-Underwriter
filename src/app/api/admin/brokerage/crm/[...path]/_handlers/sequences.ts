import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { SEQUENCE_CATALOG } from "@/lib/sequences/catalog";
import { enrollInSequence, stopSequence } from "@/lib/sequences/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brokerage/crm/sequences?entityType=lead&entityId=...
 * Lists the static catalog plus (optionally) enrollments for one entity.
 */
export async function GET(req: NextRequest) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const entityType = req.nextUrl.searchParams.get("entityType");
  const entityId = req.nextUrl.searchParams.get("entityId");

  const catalog = Object.values(SEQUENCE_CATALOG).map((s) => ({ key: s.key, label: s.label, entityType: s.entityType, stepCount: s.steps.length }));

  if (!entityType || !entityId) {
    return NextResponse.json({ ok: true, catalog, enrollments: [] });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("crm_sequence_enrollments")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("enrolled_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, catalog, enrollments: data ?? [] });
}

/**
 * POST /api/admin/brokerage/crm/sequences
 * Body: { action: "enroll", sequenceKey, entityType, entityId } | { action: "stop", enrollmentId, reason }
 */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  try {
    if (body?.action === "enroll") {
      const enrollment = await enrollInSequence({
        bankId: brokerageBankId,
        sequenceKey: body.sequenceKey,
        entityType: body.entityType,
        entityId: body.entityId,
        enrolledByClerkUserId: userId,
      });
      return NextResponse.json({ ok: true, enrollment });
    }
    if (body?.action === "stop") {
      if (typeof body?.reason !== "string" || !body.reason.trim()) {
        return NextResponse.json({ ok: false, error: "reason is required to stop a sequence" }, { status: 400 });
      }
      await stopSequence({ bankId: brokerageBankId, enrollmentId: body.enrollmentId, reason: body.reason });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "action must be enroll or stop" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
