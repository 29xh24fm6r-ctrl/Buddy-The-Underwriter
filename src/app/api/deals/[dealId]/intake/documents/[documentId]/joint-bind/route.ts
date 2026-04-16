import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({
  // Array of entity IDs this document covers (2 for joint, 1 to revert to single)
  subject_ids: z.array(z.string().uuid()).min(1).max(2),
  // Whether banker explicitly confirmed this as a joint filing
  confirmed: z.boolean(),
  detection_source: z.enum(["auto_mfj", "auto_joint_pfs", "banker_confirmed", "banker_denied"]).optional(),
});

type Ctx = { params: Promise<{ dealId: string; documentId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId, documentId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const now = new Date().toISOString();

    const patch: Record<string, unknown> = {
      subject_ids: body.subject_ids,
      // Keep assigned_owner_id in sync with first entity for backward compat
      assigned_owner_id: body.subject_ids[0],
      joint_filer_confirmed: body.confirmed,
      joint_filer_confirmed_at: now,
      joint_filer_confirmed_by: access.userId,
      joint_filer_detection_source: body.detection_source ?? "banker_confirmed",
    };

    const { error: updErr } = await (sb as any)
      .from("deal_documents")
      .update(patch)
      .eq("id", documentId)
      .eq("deal_id", dealId);

    if (updErr) {
      return NextResponse.json(
        { ok: false, error: "update_failed", detail: updErr.message },
        { status: 500 },
      );
    }

    void writeEvent({
      dealId,
      kind: body.confirmed
        ? "intake.document_joint_binding_confirmed"
        : "intake.document_joint_binding_denied",
      actorUserId: access.userId,
      scope: "intake",
      meta: {
        document_id: documentId,
        subject_ids: body.subject_ids,
        detection_source: body.detection_source,
        confirmed: body.confirmed,
      },
    });

    return NextResponse.json({ ok: true, documentId, subject_ids: body.subject_ids });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
