import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function getRequestId(req: NextRequest) {
  return (
    req.headers.get("x-request-id") ||
    req.headers.get("x-buddy-request-id") ||
    crypto.randomUUID()
  );
}

async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error(`${label} timeout after ${ms}ms`)),
        );
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

async function resolveDocForDeal(params: {
  dealId: string;
  fileId?: string | null;
  storagePath?: string | null;
}) {
  const sb = supabaseAdmin();

  if (params.fileId) {
    const { data, error } = await sb
      .from("deal_documents")
      .select("id, deal_id, storage_bucket, storage_path")
      .eq("deal_id", params.dealId)
      .eq("id", params.fileId)
      .maybeSingle();
    return { doc: data, error };
  }

  if (params.storagePath) {
    const { data, error } = await sb
      .from("deal_documents")
      .select("id, deal_id, storage_bucket, storage_path")
      .eq("deal_id", params.dealId)
      .eq("storage_path", params.storagePath)
      .maybeSingle();
    return { doc: data, error };
  }

  return { doc: null as any, error: null as any };
}

async function authorizeDealAccess(dealId: string) {
  const { userId } = await withTimeout("clerkAuth", 4_000, async () => clerkAuth());
  if (!userId) return { ok: false as const, status: 401, error: "Unauthorized" };

  const bankId = await withTimeout("getCurrentBankId", 6_000, async () => getCurrentBankId());
  const sb = supabaseAdmin();
  const { data: deal, error: dealErr } = await withTimeout("dealLookup", 8_000, async () =>
    sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle(),
  );

  if (dealErr) return { ok: false as const, status: 500, error: dealErr.message };
  if (!deal) return { ok: false as const, status: 404, error: "Deal not found" };
  if (deal.bank_id !== bankId) return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, bankId };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const requestId = getRequestId(req);
  const { dealId } = await ctx.params;

  try {
    const authz = await authorizeDealAccess(dealId);
    if (!authz.ok) {
      return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status });
    }

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get("fileId") || searchParams.get("file_id");
    const storagePath = searchParams.get("stored_name") || searchParams.get("storage_path");

    if (!fileId && !storagePath) {
      return NextResponse.json(
        { ok: false, error: "Missing fileId (or stored_name)." },
        { status: 400 },
      );
    }

    const { doc, error: docErr } = await withTimeout("docLookup", 10_000, async () =>
      resolveDocForDeal({ dealId, fileId, storagePath }),
    );

    if (docErr) {
      return NextResponse.json({ ok: false, error: docErr.message }, { status: 500 });
    }
    if (!doc) {
      return NextResponse.json(
        { ok: false, error: "File not found for this deal." },
        { status: 404 },
      );
    }

    const useBucket = String(doc.storage_bucket || "deal-uploads");
    const usePath = String(doc.storage_path);

    const sb = supabaseAdmin();
    const { data, error } = await withTimeout("createSignedUrl", 12_000, async () =>
      sb.storage.from(useBucket).createSignedUrl(usePath, 60 * 10),
    );

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { ok: false, error: error?.message || "Failed to create signed URL." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, signedUrl: data.signedUrl, requestId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("timeout") ? 504 : 500;
    return NextResponse.json({ ok: false, error: msg, requestId }, { status });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const requestId = getRequestId(req);
  const { dealId } = await ctx.params;

  try {
    const authz = await authorizeDealAccess(dealId);
    if (!authz.ok) {
      return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status });
    }

    const body = await req.json().catch(() => ({}) as any);
    const storagePath = String(body?.stored_name || body?.storage_path || "");
    const bucket = String(body?.storage_bucket || "deal-uploads");

    if (!storagePath) {
      return NextResponse.json(
        { ok: false, error: "Missing stored_name (storage path).", requestId },
        { status: 400 },
      );
    }

    const { doc, error: docErr } = await withTimeout("docLookup", 10_000, async () =>
      resolveDocForDeal({ dealId, storagePath }),
    );

    if (docErr) {
      return NextResponse.json({ ok: false, error: docErr.message, requestId }, { status: 500 });
    }
    if (!doc) {
      return NextResponse.json(
        { ok: false, error: "File not found for this deal.", requestId },
        { status: 404 },
      );
    }

    const useBucket = String(doc.storage_bucket || bucket);
    const usePath = String(doc.storage_path);

    const sb = supabaseAdmin();
    const { data, error } = await withTimeout("createSignedUrl", 12_000, async () =>
      sb.storage.from(useBucket).createSignedUrl(usePath, 60 * 10),
    );

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { ok: false, error: error?.message || "Failed to create signed URL.", requestId },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, signedUrl: data.signedUrl, requestId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("timeout") ? 504 : 500;
    return NextResponse.json({ ok: false, error: msg, requestId }, { status });
  }
}
