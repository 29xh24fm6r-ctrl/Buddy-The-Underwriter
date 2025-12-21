// src/app/api/home/command-bridge/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const bankId = url.searchParams.get("bankId");
  
  if (!bankId) {
    return NextResponse.json({ error: "Missing bankId" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // TODO: Enforce access - verify user belongs to bankId via bank_memberships

  // Stats queries
  const [
    { count: activeDeals },
    { count: needsAttention },
    { count: newUploads }
  ] = await Promise.all([
    sb.from("deals").select("id", { count: "exact", head: true }).eq("bank_id", bankId),
    sb.from("deals").select("id", { count: "exact", head: true }).eq("bank_id", bankId).eq("status", "needs_attention"),
    sb.from("deal_documents").select("id", { count: "exact", head: true }).eq("status", "pending").limit(100),
  ]);

  // Recent deals (top 6 for tiles)
  const { data: deals } = await sb
    .from("deals")
    .select("id,name,status,updated_at")
    .eq("bank_id", bankId)
    .order("updated_at", { ascending: false })
    .limit(6);

  // Intel feed
  const { data: feed } = await sb
    .from("buddy_intel_events")
    .select("id,created_at,severity,title,message,deal_id,file_id,citation_id,global_char_start,global_char_end,page,icon,meta")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(12);

  // Pick the most recent feed item that has an excerpt range as NBA "why" evidence
  const firstEvidence = (feed ?? []).find(
    (e: any) =>
      typeof e.global_char_start === "number" &&
      typeof e.global_char_end === "number" &&
      e.global_char_end > e.global_char_start
  );

  // Next Best Action (deterministic heuristic with clickable evidence chips)
  const nba = {
    title: firstEvidence ? "Review evidence Buddy just flagged" : "Review incoming evidence",
    why: [
      {
        text: `${newUploads ?? 0} new uploads`,
        dealId: null,
        fileId: null,
        citationId: null,
        globalCharStart: null,
        globalCharEnd: null,
        page: null,
        overlayId: null,
      },
      firstEvidence
        ? {
            text: "Click to open exact excerpt",
            dealId: firstEvidence.deal_id,
            fileId: firstEvidence.file_id,
            citationId: firstEvidence.citation_id,
            globalCharStart: firstEvidence.global_char_start,
            globalCharEnd: firstEvidence.global_char_end,
            page: firstEvidence.page,
            overlayId: firstEvidence.meta?.overlay_id ?? null,
          }
        : {
            text: `${needsAttention ?? 0} deals need attention`,
            dealId: null,
            fileId: null,
            citationId: null,
            globalCharStart: null,
            globalCharEnd: null,
            page: null,
            overlayId: null,
          },
    ],
    primaryCta: { label: "Open Evidence Inbox", href: "/evidence/inbox" },
  };

  return NextResponse.json({
    user: { id: user.id },
    bankId,
    stats: {
      activeDeals: activeDeals ?? 0,
      needsAttention: needsAttention ?? 0,
      newUploads: newUploads ?? 0,
    },
    deals: deals ?? [],
    feed: feed ?? [],
    nextBestAction: nba,
    health: {
      ocr: "online",
      evidence: "online",
      portal: "online",
      queueDepth: 0,
    },
  });
}
