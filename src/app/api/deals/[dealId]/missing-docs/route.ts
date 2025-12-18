// src/app/api/deals/[dealId]/missing-docs/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    if (!dealId) {
      return NextResponse.json({ ok: false, error: "missing_dealId" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // 1) Try to find an existing portal link (optional table)
    // If you don't have this table yet, it will just fail softly.
    let portalUrl: string | null = null;
    try {
      const { data: link } = await (sb as any)
        .from("borrower_portal_links")
        .select("url")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      portalUrl = link?.url ?? null;
    } catch {
      portalUrl = null;
    }

    // 2) Missing docs from conditions_to_close
    const { data: conds, error: e1 } = await (sb as any)
      .from("conditions_to_close")
      .select("id,title,satisfied,evidence")
      .eq("deal_id", dealId);

    if (e1) throw e1;

    const missing = (conds ?? [])
      .filter((c: any) => !c?.satisfied)
      .map((c: any) => ({
        title: String(c?.title ?? "Untitled condition"),
        reason: c?.evidence?.why_this_is_next_action
          ? String(c.evidence.why_this_is_next_action)
          : c?.evidence?.reason
          ? String(c.evidence.reason)
          : undefined,
      }));

    const copyText =
      `Subject: Missing documents for your loan file\n\n` +
      `Please upload the following documents:\n\n` +
      missing.map((m: { title: string; reason?: string }, i: number) => 
        `${i + 1}. ${m.title}${m.reason ? ` — ${m.reason}` : ""}`
      ).join("\n") +
      `\n\nPortal Link: ${portalUrl ?? "(not generated yet)"}`;

    return NextResponse.json({
      ok: true,
      portal: { url: portalUrl },
      missing,
      copyText,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
