import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isValidScreenId } from "@/lib/screens/idgen";

export const runtime = "edge";

/**
 * GET /api/screens/:id
 * Fetch screen artifact (anonymous allowed for public screens)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = params.id;

    if (!isValidScreenId(id)) {
      return NextResponse.json({ error: "Invalid screen ID" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("screen_artifacts")
      .select("id, title, layout_type, content, created_at, prompt, role")
      .eq("id", id)
      .eq("is_public", true)
      .maybeSingle();

    if (error) {
      console.error("Fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch screen" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Screen not found" }, { status: 404 });
    }

    // Increment view count (fire and forget)
    sb.from("screen_artifacts")
      .update({ view_count: (data as any).view_count + 1 })
      .eq("id", id)
      .then(() => {});

    return NextResponse.json({
      id: data.id,
      title: data.title,
      layoutType: data.layout_type,
      content: data.content,
      createdAt: data.created_at,
      prompt: data.prompt,
      role: data.role,
    });
  } catch (err) {
    console.error("Screen fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
