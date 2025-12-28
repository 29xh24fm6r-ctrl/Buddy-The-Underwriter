import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const sb = supabaseAdmin();
  const { token } = await ctx.params;
  const body = await req.json().catch(() => null);

  if (!body?.filename) return NextResponse.json({ error: "filename required" }, { status: 400 });

  const { data: link } = await sb.from("borrower_portal_links").select("deal_id").eq("token", token).maybeSingle();
  if (!link) return NextResponse.json({ error: "Invalid token" }, { status: 404 });

  const ext = body.filename.includes(".") ? body.filename.split(".").pop() : "bin";
  const key = crypto.randomUUID();
  const bucket = "uploads";
  const path = `borrower/${link.deal_id}/${key}.${ext}`;

  // Create signed upload URL (Supabase Storage)
  const { data, error } = await sb.storage.from(bucket).createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    bucket,
    path,
    signedUrl: data.signedUrl,
    token,
    deal_id: link.deal_id,
  });
}
