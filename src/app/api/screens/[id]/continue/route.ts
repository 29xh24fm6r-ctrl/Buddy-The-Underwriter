import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isValidScreenId, generateScreenId } from "@/lib/screens/idgen";
import { generateScreenFromPrompt } from "@/lib/screens/templates";
import { checkContinueLimit, incrementContinueUsage } from "@/lib/usage/limits";

export const runtime = "nodejs"; // Changed from edge for usage tracking

/**
 * POST /api/screens/:id/continue
 * Create new screen derived from prior (auth required)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = params.id;

    if (!isValidScreenId(id)) {
      return NextResponse.json({ error: "Invalid screen ID" }, { status: 400 });
    }

    const sb = await getSupabaseServerClient();

    // Check auth
    const {
      data: { user },
    } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Authentication required",
          redirect: `/auth?next=/s/${id}`,
        },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    const role = body.role ? String(body.role) : null;

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 },
      );
    }

    // Check usage limits
    const limitCheck = await checkContinueLimit(user.id);

    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: "Continue limit reached",
          redirect: "/upgrade",
          usage: limitCheck.usage,
        },
        { status: 402 }, // Payment Required
      );
    }

    // Generate new screen
    const { title, layoutType, content } = generateScreenFromPrompt({
      prompt,
      role,
    });

    const newId = generateScreenId();
    const sbAdmin = supabaseAdmin();

    const { error: insertError } = await sbAdmin
      .from("screen_artifacts")
      .insert({
        id: newId,
        prompt,
        role,
        title,
        layout_type: layoutType,
        content,
        status: "generated",
        owner_id: user.id, // Auto-owned by authenticated user
        is_public: true,
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create screen" },
        { status: 500 },
      );
    }

    // Increment usage for free users (fire and forget for pro)
    if (limitCheck.usage.plan === "free") {
      incrementContinueUsage(user.id).catch((err) =>
        console.error("Failed to increment usage:", err),
      );
    }

    const shareUrl = `/s/${newId}`;

    return NextResponse.json({
      id: newId,
      shareUrl,
      usage: limitCheck.usage,
    });
  } catch (err) {
    console.error("Continue error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
