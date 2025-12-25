import { NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  try {
    // Create ephemeral token for Realtime API
    // This allows browser to connect without exposing API key
    const response = await client.responses.create({
      model: "gpt-4o-realtime-preview-2024-12-17",
      // The session will be established via WebRTC in the browser
    });

    return NextResponse.json({
      sessionId: response.id,
      // Additional session data will be provided by OpenAI
    });
  } catch (error) {
    console.error("[Realtime Session] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Session creation failed",
      },
      { status: 500 },
    );
  }
}
