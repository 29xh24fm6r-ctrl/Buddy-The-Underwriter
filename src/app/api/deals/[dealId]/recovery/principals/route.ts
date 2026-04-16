import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({
  actions: z.array(z.object({
    id: z.string().uuid(),
    action: z.enum(["rename", "keep"]),
    new_name: z.string().min(2).max(200).optional(),
  })),
});

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
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
    const results: Array<{ id: string; action: string; ok: boolean }> = [];

    for (const item of body.actions) {
      if (item.action === "rename" && item.new_name) {
        const { error } = await (sb as any)
          .from("ownership_entities")
          .update({ display_name: item.new_name.trim() })
          .eq("id", item.id)
          .eq("deal_id", dealId); // Safety: only update if belongs to this deal
        results.push({ id: item.id, action: "rename", ok: !error });
      } else {
        results.push({ id: item.id, action: "keep", ok: true });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
