import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signUploadUrl } from "@/lib/uploads/sign";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ token: string }>;
};

/**
 * POST /api/portal/[token]/files/sign
 * 
 * Borrower portal version of signed upload URL generator.
 * Authorization via portal token instead of Clerk auth.
 * Otherwise identical to banker endpoint.
 * 
 * Flow:
 * 1. Validate portal token
 * 2. Validate file metadata
 * 3. Return signed upload URL
 * 4. Client uploads directly to storage
 * 5. Client calls /files/record
 */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { token } = await ctx.params;
    const body = await req.json();

    const {
      filename,
      mime_type,
      size_bytes,
      checklist_key = null,
    } = body ?? {};

    if (!filename || !size_bytes) {
      return NextResponse.json(
        { ok: false, error: "Missing filename or size_bytes" },
        { status: 400 },
      );
    }

    // Verify token and get deal_id
    const sb = supabaseAdmin();

    const { data: link, error: linkErr } = await sb
      .from("borrower_portal_links")
      .select("deal_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkErr || !link) {
      console.error("[portal/files/sign] invalid token", { token, linkErr });
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    // Check expiration
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json(
        { ok: false, error: "Link expired" },
        { status: 403 },
      );
    }

    const dealId = link.deal_id;

    // Bank-safe guardrails
    const MAX_BYTES = 50 * 1024 * 1024; // 50MB
    if (size_bytes > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "File too large (max 50MB)" },
        { status: 413 },
      );
    }

    // Generate unique file ID and safe path
    const fileId = crypto.randomUUID();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath = `deals/${dealId}/${fileId}__${safeName}`;

    // Use centralized signing utility
    const bucket = process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";
    const signResult = await signUploadUrl({ bucket, objectPath });

    if (!signResult.ok) {
      console.error("[portal/files/sign] failed to create signed URL", {
        requestId: signResult.requestId,
        error: signResult.error,
        detail: signResult.detail,
      });
      return NextResponse.json(
        {
          ok: false,
          requestId: signResult.requestId,
          error: signResult.error,
          details: signResult.detail,
        },
        { status: 500 },
      );
    }

    const signed = {
      signedUrl: signResult.signedUrl,
      token: signResult.token,
      path: signResult.path,
    };

    console.log("[portal/files/sign] created signed URL", {
      dealId,
      fileId,
      filename: safeName,
      size_bytes,
      token,
    });

    return NextResponse.json({
      ok: true,
      upload: {
        file_id: fileId,
        object_path: objectPath,
        signed_url: signed.signedUrl,
        token: signed.token,
        checklist_key,
      },
    });
  } catch (error: any) {
    console.error("[portal/files/sign]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
