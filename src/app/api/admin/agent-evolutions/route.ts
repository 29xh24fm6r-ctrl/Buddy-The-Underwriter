import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — list pending evolutions
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin();
    const sb = supabaseAdmin();

    const url = new URL(req.url);
    const agentId = url.searchParams.get("agent_id");
    const includeDone = url.searchParams.get("include_done") === "true";

    let query = sb
      .from("agent_skill_evolutions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (agentId) query = query.eq("agent_id", agentId);
    if (!includeDone) query = query.eq("applied", false).eq("rejected", false);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ ok: true, evolutions: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "internal" },
      { status: err?.message === "forbidden" ? 403 : 500 },
    );
  }
}

// POST — approve or reject a pending evolution
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin();
    const { userId } = await clerkAuth();
    const sb = supabaseAdmin();

    const body = await req.json();
    const { evolution_id, action } = body as {
      evolution_id: string;
      action: "approve" | "reject";
    };

    if (!evolution_id || !action) {
      return NextResponse.json(
        { ok: false, error: "evolution_id and action required" },
        { status: 400 },
      );
    }

    if (action === "approve") {
      await sb
        .from("agent_skill_evolutions")
        .update({
          applied: true,
          approved_by: userId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", evolution_id)
        .eq("applied", false)
        .eq("rejected", false);

      return NextResponse.json({
        ok: true,
        message:
          "Evolution approved. A developer must now increment PROMPT_VERSION " +
          "in geminiFlashPrompts.ts and incorporate the proposed_change content. " +
          "This is the required human-in-the-loop gate per OCC SR 11-7.",
      });
    }

    if (action === "reject") {
      await sb
        .from("agent_skill_evolutions")
        .update({
          rejected: true,
          rejected_by: userId,
          rejected_at: new Date().toISOString(),
        })
        .eq("id", evolution_id)
        .eq("applied", false)
        .eq("rejected", false);

      return NextResponse.json({ ok: true, message: "Evolution rejected." });
    }

    return NextResponse.json(
      { ok: false, error: "action must be approve or reject" },
      { status: 400 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "internal" },
      { status: err?.message === "forbidden" ? 403 : 500 },
    );
  }
}
