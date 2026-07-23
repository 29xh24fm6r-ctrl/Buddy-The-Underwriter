import "server-only";

/**
 * mintRealtimeClientSecret — shared by both the banker-session and
 * brokerage-voice token routes (SPEC-BUDDY-VOICE-WEBRTC §1). Mints a
 * short-lived OpenAI Realtime client_secret with the full session config
 * (persona, voice, turn detection, transcription, tools) embedded at
 * creation time — the browser's WebRTC connection starts pre-configured,
 * no separate session.update round trip needed once connected.
 *
 * The real OPENAI_API_KEY is used here, server-side, to mint the secret —
 * it never reaches the browser. Only the returned client_secret (60s TTL)
 * crosses the wire to the client, mirroring the existing, already-proven
 * pattern in src/app/api/deals/[dealId]/voice/token/route.ts.
 */

const CLIENT_SECRET_TTL_SECONDS = 60;

interface MintArgs {
  model: string;
  voice: string;
  instructions: string;
  transcribeModel?: string;
  tools?: readonly unknown[];
}

type MintResult =
  | { ok: true; clientSecret: string; expiresAt: string | null }
  | { ok: false; error: string; status?: number };

export async function mintRealtimeClientSecret(args: MintArgs): Promise<MintResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "missing_openai_api_key" };
  }

  const body = {
    expires_after: { seconds: CLIENT_SECRET_TTL_SECONDS },
    session: {
      type: "realtime",
      model: args.model,
      instructions: args.instructions,
      audio: {
        output: { voice: args.voice },
        input: {
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            interrupt_response: true,
            create_response: true,
          },
          transcription: {
            model: args.transcribeModel ?? "gpt-4o-mini-transcribe",
          },
        },
      },
      ...(args.tools ? { tools: args.tools, tool_choice: "auto" } : {}),
    },
  };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `openai_client_secret_failed: ${detail}`, status: res.status };
  }

  const data = await res.json().catch(() => null) as
    | { value?: string; expires_at?: string; client_secret?: { value?: string; expires_at?: string } }
    | null;

  const clientSecret = data?.value ?? data?.client_secret?.value ?? null;
  if (!clientSecret) {
    return { ok: false, error: "openai_client_secret_missing_value" };
  }

  const expiresAt = data?.expires_at ?? data?.client_secret?.expires_at ?? null;
  return { ok: true, clientSecret, expiresAt };
}
