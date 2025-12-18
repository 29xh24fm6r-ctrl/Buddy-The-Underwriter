import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSignedDownloadUrl } from "@/lib/storage/adminStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;

    const { data, error } = await supabaseAdmin()
      .from("filled_bank_documents")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false }) as any;

    if (error) throw error;

    const rows = data ?? [];
    const withUrls = await Promise.all(
      rows.map(async (r: any) => {
        const url = await createSignedDownloadUrl({
          bucket: "filled-documents",
          path: r.output_file_path,
          expiresInSeconds: 60 * 10,
        });
        return { ...r, download_url: url };
      })
    );

    return NextResponse.json({ ok: true, documents: withUrls });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
