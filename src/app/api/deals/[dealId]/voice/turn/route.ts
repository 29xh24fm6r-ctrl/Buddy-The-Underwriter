// src/app/api/deals/[dealId]/voice/turn/route.ts
import { NextRequest, NextResponse } from "next/server";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type Body = {
  transcript: string;
  // optional: confidence, item_id, etc
  source?: "realtime";
  meta?: Record<string, any>;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.transcript || typeof body.transcript !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const transcript = body.transcript.trim();
  if (!transcript)
    return NextResponse.json({ error: "empty_transcript" }, { status: 400 });

  // Service role insert (server-side only).
  // If you already have a "server authed supabase client" helper, swap this to that.
  const supabaseUrl = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRole = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });

  const insertPayload = {
    deal_id: dealId,
    role: "borrower",
    channel: "voice",
    text: transcript,
    created_by: userId,
    meta: {
      ...(body.meta || {}),
      source: body.source || "realtime",
    },
  };

  const { data, error } = await sb
    .from("deal_interview_turns")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "supabase_insert_failed", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, turn: data });
}
