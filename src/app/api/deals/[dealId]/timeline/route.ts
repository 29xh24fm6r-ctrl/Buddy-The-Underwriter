// src/app/api/deals/[dealId]/timeline/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerPlaybookForStage } from "@/lib/deals/playbook";
import { computeChecklistHighlight } from "@/lib/borrower/highlightChecklist";
import { isDemoMode, demoState } from "@/lib/demo/demoMode";
import { mockTimelineData } from "@/lib/demo/mocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TimelineEvent = {
  id: string;
  ts: string;
  kind: string;
  title: string;
  detail?: string;
  status?: "started" | "completed" | "blocked" | "failed" | "info";
};

type TimelineResponse = {
  ok: boolean;
  events?: TimelineEvent[];
  error?: string;
};

function normalizeStatus(row: any): TimelineEvent["status"] {
  const s = String(row.status ?? row.level ?? "").toLowerCase();
  if (s === "started") return "started";
  if (s === "completed" || s === "success" || s === "succeeded") return "completed";
  if (s === "blocked" || s === "warning") return "blocked";
  if (s === "failed" || s === "error") return "failed";
  return "info";
}

function normalizeKind(row: any): string {
  // Prefer explicit kind fields if present, otherwise map event_type to the UI icon map.
  const raw = String(row.kind ?? row.event_type ?? row.type ?? "other").toLowerCase();
  if (raw.includes("upload")) return "upload";
  if (raw.includes("doc")) return "doc_received";
  if (raw.includes("seed")) return "auto_seed";
  if (raw.includes("checklist")) return "checklist";
  if (raw.includes("ocr")) return "ocr";
  if (raw.includes("ai")) return "ai";
  if (raw.includes("ready") || raw.includes("readiness")) return "readiness";
  return "other";
}

function toEvent(row: any): TimelineEvent {
  const ts = row.created_at ?? row.ts ?? row.at ?? new Date().toISOString();
  const title = row.title ?? row.message ?? "Event";
  const detail =
    row.detail ??
    (typeof row.meta === "string" ? row.meta : row.meta ? JSON.stringify(row.meta) : undefined);

  return {
    id: String(row.id),
    ts: String(ts),
    kind: normalizeKind(row),
    title: String(title),
    detail: detail ? String(detail) : undefined,
    status: normalizeStatus(row),
  };
}

// This is intentionally server-only read.
// You can later split into banker vs borrower auth.
// For now:
// - Banker UI can call with header x-user-id (optional)
// - Borrower portal can call with invite token and you can validate upstream
// DEMO MODE: Supports ?__mode=demo&__state=empty|converging|ready|blocked
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    // Demo mode support
    const searchParams = req.nextUrl.searchParams;
    if (isDemoMode(searchParams)) {
      const state = demoState(searchParams);
      return NextResponse.json(mockTimelineData(state));
    }

    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    // Check if this is a simple timeline request (for CinematicTimeline)
    const simple = searchParams.get("simple") === "true";

    const { data: status, error: sErr } = await sb
      .from("deal_status")
      .select("deal_id, stage, eta_date, eta_note, updated_at")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (sErr && !simple) throw sErr;

    const { data: events, error: eErr } = await sb
      .from("deal_timeline_events")
      .select("id, kind, title, detail, meta, visible_to_borrower, created_at, status, level, event_type")
      .eq("deal_id", dealId)
      .eq("visible_to_borrower", true)
      .order("created_at", { ascending: false })
      .limit(100);

    if (eErr && !simple) throw eErr;

    // Simple mode: just return events in CinematicTimeline format
    if (simple) {
      const res: TimelineResponse = { 
        ok: true, 
        events: (events ?? []).map(toEvent)
      };
      return NextResponse.json(res);
    }

    // Full mode: return enriched response for borrower portal
    const stage = status?.stage ?? "intake";
    const playbook = await getBorrowerPlaybookForStage(stage);

    const latestDoc =
      (events ?? []).find((e) => e.kind === "doc_received") ?? null;

    const highlight = playbook?.borrower_steps?.length
      ? computeChecklistHighlight({
          playbookSteps: playbook.borrower_steps,
          latestDocReceivedEvent: latestDoc
            ? {
                title: latestDoc.title,
                detail: latestDoc.detail,
                meta: (latestDoc as any).meta,
              }
            : null,
        })
      : null;

    // Map events to include 'ts' field for CinematicTimeline compatibility
    const mappedEvents = (events ?? []).map(toEvent);

    return NextResponse.json({
      ok: true,
      status: status ?? null,
      playbook,
      highlight,
      events: mappedEvents,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
