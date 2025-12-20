import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

/**
 * GET /api/banks/policy/chunks?asset_id=uuid
 * 
 * List all chunks for a specific asset (or all chunks if no asset_id provided).
 * 
 * Query params:
 * - asset_id: UUID (optional)
 * 
 * Returns:
 * {
 *   "chunks": [...chunk objects with asset info]
 * }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const bankId = await getCurrentBankId();
    const { searchParams } = new URL(req.url);
    const assetId = searchParams.get("asset_id");

    let query = supabaseAdmin()
      .from("bank_policy_chunks")
      .select(`
        id,
        asset_id,
        chunk_index,
        text,
        page_start,
        page_end,
        section_title,
        created_at,
        bank_assets!inner (
          id,
          title,
          kind
        )
      `)
      .eq("bank_id", bankId)
      .order("asset_id", { ascending: true })
      .order("chunk_index", { ascending: true });

    if (assetId) {
      query = query.eq("asset_id", assetId);
    }

    const { data: chunks, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ chunks: chunks || [] });
  } catch (err: any) {
    console.error("[/api/banks/policy/chunks] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/banks/policy/chunks?asset_id=uuid
 * 
 * Delete all chunks for a specific asset.
 * 
 * Query params:
 * - asset_id: UUID (required)
 * 
 * Returns:
 * {
 *   "deleted": 42
 * }
 */

export async function DELETE(req: NextRequest) {
  try {
    const bankId = await getCurrentBankId();
    const { searchParams } = new URL(req.url);
    const assetId = searchParams.get("asset_id");

    if (!assetId) {
      return NextResponse.json(
        { error: "asset_id required" },
        { status: 400 }
      );
    }

    // Delete all chunks for this asset
    const { data, error } = await supabaseAdmin()
      .from("bank_policy_chunks")
      .delete()
      .eq("bank_id", bankId)
      .eq("asset_id", assetId)
      .select();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      deleted: data?.length || 0,
    });
  } catch (err: any) {
    console.error("[/api/banks/policy/chunks DELETE] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
