import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";

// ▸▸▸ SPEC-BORROWER-RESUME-PERSISTENCE-V1 — intake progress persistence
//
// GET  /api/borrower/intake/progress — load saved progress for hydration
// POST /api/borrower/intake/progress — save chapter transition atomically
//
// This endpoint is the single canonical writer for borrower_intake_progress.
// The seal-status endpoint (used for fieldProgress computation) falls back
// to this table when borrower_concierge_sessions has no data.

const LOG_PREFIX = "[intake-progress]";

/** GET: Load saved intake progress for the current deal (from session cookie). */
export async function GET() {
  try {
    const session = await getBorrowerSession();
    if (!session?.deal_id) {
      return NextResponse.json(
        { ok: false, error: "no_session" },
        { status: 401 },
      );
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("borrower_intake_progress")
      .select("current_chapter, purposes, total_amount, completed_chapters, updated_at")
      .eq("deal_id", session.deal_id)
      .maybeSingle();

    if (error) {
      console.error(`${LOG_PREFIX} load failed deal=${session.deal_id}`, error);
      return NextResponse.json(
        { ok: false, error: "load_failed" },
        { status: 500 },
      );
    }

    console.log(
      `${LOG_PREFIX} loaded deal=${session.deal_id} chapter=${data?.current_chapter ?? "none"} purposes=${(data?.purposes ?? []).join(",") || "none"} total=${data?.total_amount ?? 0}`,
    );

    return NextResponse.json({
      ok: true,
      progress: data
        ? {
            currentChapter: data.current_chapter,
            purposes: data.purposes,
            totalAmount: data.total_amount,
            completedChapters: data.completed_chapters,
            updatedAt: data.updated_at,
          }
        : null,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} load error`, err);
    return NextResponse.json(
      { ok: false, error: "internal" },
      { status: 500 },
    );
  }
}

/** POST: Save or update intake progress atomically. */
export async function POST(request: Request) {
  try {
    const session = await getBorrowerSession();
    if (!session?.deal_id) {
      return NextResponse.json(
        { ok: false, error: "no_session" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const dealId = session.deal_id;

    // Validate chapter (1-5)
    const chapter = body.chapter;
    if (typeof chapter !== "number" || chapter < 1 || chapter > 5) {
      return NextResponse.json(
        { ok: false, error: "invalid_chapter" },
        { status: 400 },
      );
    }

    // Only update fields that are provided
    const purposes: string[] | undefined = Array.isArray(body.purposes)
      ? body.purposes
      : undefined;
    const totalAmount: number | undefined =
      typeof body.totalAmount === "number" ? body.totalAmount : undefined;
    const completedChapters: number[] | undefined = Array.isArray(
      body.completedChapters,
    )
      ? body.completedChapters
      : undefined;

    // Compute completed chapters: union of existing + the chapter being left
    const sb = supabaseAdmin();

    // Use upsert to handle both insert and update atomically
    const { data: existing } = await sb
      .from("borrower_intake_progress")
      .select("completed_chapters, purposes, total_amount")
      .eq("deal_id", dealId)
      .maybeSingle();

    const priorChapters = (existing?.completed_chapters as number[]) ?? [];
    const newCompletedChapters = completedChapters ?? priorChapters;

    // Merge prior purposes and total if not provided
    const finalPurposes = purposes ?? (existing?.purposes as string[]) ?? [];
    const finalTotal = totalAmount ?? (existing?.total_amount as number) ?? 0;

    // Ensure prior chapters are marked complete (but not the current one)
    // A chapter is "completed" when the user navigates past it
    const mergedCompleted = Array.from(
      new Set([...newCompletedChapters, ...priorChapters]),
    );

    const { error } = await sb.from("borrower_intake_progress").upsert(
      {
        deal_id: dealId,
        current_chapter: chapter,
        purposes: finalPurposes,
        total_amount: finalTotal,
        completed_chapters: mergedCompleted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id" },
    );

    if (error) {
      console.error(`${LOG_PREFIX} save failed deal=${dealId} ch=${chapter}`, error);
      return NextResponse.json(
        { ok: false, error: "save_failed" },
        { status: 500 },
      );
    }

    console.log(
      `${LOG_PREFIX} saved deal=${dealId} ch=${chapter} purposes=${finalPurposes.join(",") || "none"} total=${finalTotal} completed=${mergedCompleted.join(",") || "none"}`,
    );

    return NextResponse.json({
      ok: true,
      progress: {
        currentChapter: chapter,
        purposes: finalPurposes,
        totalAmount: finalTotal,
        completedChapters: mergedCompleted,
      },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} save error`, err);
    return NextResponse.json(
      { ok: false, error: "internal" },
      { status: 500 },
    );
  }
}
