import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TimelineStep = {
  id: "upload" | "review" | "uw" | "approval" | "closing";
  title: string;
  subtitle: string;
  state: "done" | "current" | "upcoming";
};

function toIso(d: Date) {
  return d.toISOString();
}

// Adds business hours (Mon–Fri) in a simple, deterministic way.
// For ETA UX: this is "good enough" and borrower-safe.
function addBusinessHours(start: Date, hours: number) {
  let d = new Date(start.getTime());
  let remaining = Math.max(0, Math.floor(hours));

  function isWeekend(dt: Date) {
    const day = dt.getDay(); // 0 Sun .. 6 Sat
    return day === 0 || day === 6;
  }

  while (remaining > 0) {
    d = new Date(d.getTime() + 60 * 60 * 1000); // +1 hour
    if (!isWeekend(d)) remaining -= 1;
  }

  return d;
}

function statusIsReceived(status?: string | null) {
  const s = String(status || "").trim().toLowerCase();
  return s === "received" || s === "complete" || s === "done";
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    const invite = await requireValidInvite(token);
    const bank_id = invite.bank_id;
    const deal_id = invite.deal_id;

    const reqsRes = await sb
      .from("borrower_document_requests")
      .select("id, status, received_at, updated_at")
      .eq("deal_id", deal_id);

    if (reqsRes.error) throw new Error(reqsRes.error.message);

    const rows = reqsRes.data || [];
    const total = rows.length;
    const received = rows.filter((r: any) => statusIsReceived(r.status)).length;
    const missing = Math.max(0, total - received);

    // Compute last received timestamp (if any)
    let lastReceivedAt: Date | null = null;
    for (const r of rows as any[]) {
      const dt = r.received_at || null;
      if (!dt) continue;
      const d = new Date(dt);
      if (!lastReceivedAt || d.getTime() > lastReceivedAt.getTime()) lastReceivedAt = d;
    }

    // Determine stage purely from borrower-safe facts:
    // - If missing docs -> Upload
    // - If all docs received -> Bank Review (then Underwriting/Approval/Closing are upcoming placeholders)
    const now = new Date();

    const stage =
      total === 0 ? "waiting_for_checklist" : missing > 0 ? "uploading_docs" : "bank_review";

    // Borrower-safe ETA heuristic:
    // - If still uploading -> ETA null
    // - If complete -> "Bank review" ETA = lastReceivedAt + 24 business hours (or now if missing)
    const etaForReview =
      stage === "bank_review"
        ? addBusinessHours(lastReceivedAt || now, 24)
        : null;

    const stepsBase: Omit<TimelineStep, "state">[] = [
      { id: "upload", title: "Upload documents", subtitle: "Drag & drop everything you have" },
      { id: "review", title: "Bank review", subtitle: "We check completeness + match items" },
      { id: "uw", title: "Underwriting", subtitle: "Credit team reviews the request" },
      { id: "approval", title: "Approval", subtitle: "Decision + terms confirmed" },
      { id: "closing", title: "Closing", subtitle: "Docs signed and funding scheduled" },
    ];

    function withState(): TimelineStep[] {
      if (stage === "waiting_for_checklist") {
        return stepsBase.map((s) => ({
          ...s,
          state: s.id === "upload" ? "current" : "upcoming",
        }));
      }

      if (stage === "uploading_docs") {
        return stepsBase.map((s) => ({
          ...s,
          state: s.id === "upload" ? "current" : "upcoming",
        }));
      }

      // bank_review stage
      return stepsBase.map((s) => {
        if (s.id === "upload") return { ...s, state: "done" };
        if (s.id === "review") return { ...s, state: "current" };
        return { ...s, state: "upcoming" };
      });
    }

    const steps = withState();

    // Progress: use checklist completion as the truth anchor.
    // When complete, show 40% (upload done + review current), keeping room for later stages.
    const pctChecklist = total > 0 ? Math.round((received / total) * 100) : 0;
    const progress =
      stage === "bank_review" ? 40 : stage === "uploading_docs" ? Math.min(30, Math.round(pctChecklist * 0.3)) : 0;

    return NextResponse.json({
      ok: true,
      bank_id,
      deal_id,
      checklist: { total, received, missing, pct: pctChecklist },
      stage,
      timeline: steps,
      eta: {
        banker_review_by: etaForReview ? toIso(etaForReview) : null,
      },
      progress,
      updated_at: toIso(now),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "status_failed" }, { status: 400 });
  }
}
