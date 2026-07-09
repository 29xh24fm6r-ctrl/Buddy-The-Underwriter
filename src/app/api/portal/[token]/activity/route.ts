import { NextResponse } from "next/server";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function normalizeEvent(
  event: { id: string; event_type: string | null; title: string | null; detail: string | null; created_at: string },
  idx: number,
) {
  const eventType = String(event.event_type ?? "").toUpperCase();
  const title = String(event.title ?? "");
  const detail = String(event.detail ?? "");

  if (eventType === "DOC_RECEIVED") {
    return {
      id: event.id || `evt-${idx}`,
      kind: "upload" as const,
      title: "Buddy received your document",
      detail: "Your file was added to the secure SBA package and is ready for review.",
      createdAt: event.created_at,
    };
  }

  if (eventType.includes("CHECKLIST") || title.toLowerCase().includes("request")) {
    return {
      id: event.id || `evt-${idx}`,
      kind: "request" as const,
      title: "Additional document requested",
      detail: "Buddy updated your request list so you can keep the package moving.",
      createdAt: event.created_at,
    };
  }

  if (title.toLowerCase().includes("review")) {
    return {
      id: event.id || `evt-${idx}`,
      kind: "review" as const,
      title: "Buddy reviewed your document",
      detail: "Buddy checked your latest upload and updated your package status.",
      createdAt: event.created_at,
    };
  }

  if (eventType || detail) {
    return {
      id: event.id || `evt-${idx}`,
      kind: "package" as const,
      title: "SBA package progressing",
      detail: "Buddy updated your package and will let you know if anything else is needed.",
      createdAt: event.created_at,
    };
  }

  return null;
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const invite = await resolveBorrowerToken(token);
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("deal_timeline_events")
      .select("id, event_type, title, detail, created_at")
      .eq("deal_id", invite.deal_id)
      .eq("visibility", "borrower")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    const activities = (data ?? [])
      .map((event: any, idx: number) => normalizeEvent(event, idx))
      .filter(Boolean)
      .slice(0, 8);

    return NextResponse.json({ ok: true, activities });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Unable to load activity right now.",
      },
      { status: 400 },
    );
  }
}
