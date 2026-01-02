// src/app/api/deals/[dealId]/voice/token/route.ts
import { NextResponse } from "next/server";
// If you already have Clerk in this repo (you likely do), keep this.
// If not, swap this auth check to whatever you use.
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const apiKey = mustEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
  const voice = process.env.OPENAI_REALTIME_VOICE || "marin";
  const transcribeModel =
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

  // Session config:
  // - realtime conversation (speech-to-speech)
  // - server VAD for natural turn-taking & interruptions
  // - async transcription enabled so we can store provable text
  // Docs: client secrets + session config.
  const body = {
    expires_after: { seconds: 60 }, // short-lived client secret
    session: {
      type: "realtime",
      model,
      instructions: [
        `You are Buddy, an AI lending assistant for a commercial bank.`,
        `Always be transparent: you are an AI assistant ("Buddy") and not a human.`,
        `Your job: conduct a friendly borrower interview to collect only verifiable facts.`,
        `Ask ONE question at a time. Avoid assumptions. If unsure, ask a clarifying question.`,
        `When you hear a number, date, percentage, legal name, address, or ownership detail, immediately restate it and ask for confirmation.`,
        `Never use tone, pauses, hesitation, or other non-quantifiable cues for decisions.`,
        `Keep responses concise and borrower-friendly.`,
        `Deal context: dealId=${dealId}.`,
      ].join("\n"),
      audio: {
        output: { voice },
        input: {
          // Natural, "human" turn-taking:
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            interrupt_response: true,
            create_response: true,
          },
          // Transcription so we can store text evidence:
          transcription: {
            model: transcribeModel,
            language: "en",
          },
          noise_reduction: { type: "near_field" },
        },
      },
      include: ["item.input_audio_transcription.logprobs"],
    },
  };

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    return NextResponse.json(
      { error: "openai_client_secret_failed", status: r.status, details: txt },
      { status: 500 },
    );
  }

  const data = await r.json();
  // OpenAI returns a client secret that looks like ek_...
  return NextResponse.json(data);
}
