import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateScreenFromPrompt } from "@/lib/screens/templates";
import { generateScreenId } from "@/lib/screens/idgen";

export const runtime = "edge";

/**
 * POST /api/generate
 * Generate a screen artifact from prompt (anonymous allowed)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    const role = body.role ? String(body.role) : null;

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 },
      );
    }

    // Generate screen content using deterministic templates
    const { title, layoutType, content } = generateScreenFromPrompt({
      prompt,
      role,
    });

    // Create artifact in database
    const id = generateScreenId();
    const sb = supabaseAdmin();

    const { error: insertError } = await sb.from("screen_artifacts").insert({
      id,
      prompt,
      role,
      title,
      layout_type: layoutType,
      content,
      status: "generated",
      is_public: true,
    });

    if (insertError) {
      console.error("Insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create screen" },
        { status: 500 },
      );
    }

    const shareUrl = `/s/${id}`;

    return NextResponse.json({
      id,
      shareUrl,
    });
  } catch (err) {
    console.error("Generate error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
