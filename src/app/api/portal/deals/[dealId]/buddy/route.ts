// src/app/api/portal/deals/[dealId]/buddy/route.ts
import { NextResponse } from "next/server";
import { requireValidInvite } from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BuddyResult = {
  reply: string;
  toneTag: "calm" | "cheerful" | "reassuring" | "direct";
  nextBestUpload: { title: string; why: string } | null;
  quickReplies: string[];
};

/**
 * Canonical Buddy chat endpoint
 * - Borrower-safe responses only
 * - No underwriting jargon
 * - Suggests next best upload from missing required items
 */
export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace(/^Bearer\s+/i, "");
    
    const invite = await requireValidInvite(token);
    const { dealId } = await ctx.params;

    // Verify deal matches invite
    if (invite.deal_id !== dealId) throw new Error("Deal ID mismatch");

    const body = await req.json();
    const message = String(body?.message ?? "").trim().toLowerCase();
    const snapshot = body?.snapshot ?? {};

    // Detect intent (simple keyword matching - deterministic)
    const isAskingNextUpload =
      message.includes("what") && (message.includes("next") || message.includes("upload"));
    const isAskingProgress = message.includes("progress") || message.includes("status");
    const isCantFind = message.includes("can't find") || message.includes("missing");
    const isAskingPhotos = message.includes("photo") || message.includes("screenshot");
    const isAskingWhatHappens = message.includes("what happens") || message.includes("next step");

    // Find next best upload from missing required items
    const checklist = snapshot?.checklist ?? [];
    const missing = checklist.filter(
      (i: any) => i.required && i.status === "missing"
    );
    const nextBest = missing[0] ?? null;

    let reply = "";
    let toneTag: BuddyResult["toneTag"] = "cheerful";
    let quickReplies: string[] = [
      "What should I upload next?",
      "I can't find one of the documents",
      "Can I upload phone photos?",
      "What happens next?",
    ];

    if (isAskingNextUpload) {
      if (nextBest) {
        reply = `The fastest path forward: upload **${nextBest.title}**.\n\n${nextBest.description || "We'll handle the rest."}\n\nDon't worry about perfect naming — we match intelligently.`;
        toneTag = "direct";
      } else {
        reply = `You've uploaded everything required! 🎉\n\nWe're reviewing now. If we need anything else, we'll message you here.`;
        toneTag = "cheerful";
      }
    } else if (isAskingProgress) {
      const pct = snapshot?.progress?.percent ?? 0;
      const done = snapshot?.progress?.requiredDone ?? 0;
      const total = snapshot?.progress?.requiredTotal ?? 0;
      reply = `You're ${pct}% done (${done} / ${total} required items received).\n\n${
        pct >= 70
          ? "You're crushing it! Just a few more."
          : pct >= 35
          ? "Great start. Each upload is a level-up."
          : "No stress — go at your own pace."
      }`;
      toneTag = "reassuring";
    } else if (isCantFind) {
      reply = `No worries — this happens all the time.\n\nTap "I can't find it" above and I'll suggest easy substitutes. You can also send a note to your bank asking for alternatives.`;
      toneTag = "calm";
      quickReplies = [
        "I can't find one of the documents",
        "What's the best substitute?",
        "Can I upload what I have?",
        "What happens next?",
      ];
    } else if (isAskingPhotos) {
      reply = `Yes! Phone photos are totally fine.\n\nJust make sure text is readable. If it's blurry, try again with better lighting.\n\nWe'll let you know if we need a clearer version.`;
      toneTag = "direct";
    } else if (isAskingWhatHappens) {
      reply = `Here's the flow:\n\n1. You upload documents (we auto-check your list)\n2. We review everything (usually 1–2 business days)\n3. We message you with next steps or approval\n\nYou'll see updates right here in the portal.`;
      toneTag = "direct";
    } else {
      // Default friendly response
      reply = `Hey — I'm here to help! 😊\n\nTry asking:\n• "What should I upload next?"\n• "I can't find a document"\n• "What happens next?"\n\nOr just upload what you have — we'll guide you from there.`;
      toneTag = "cheerful";
    }

    const result: BuddyResult = {
      reply,
      toneTag,
      nextBestUpload: nextBest
        ? { title: nextBest.title, why: nextBest.description || "Required" }
        : null,
      quickReplies,
    };

    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
