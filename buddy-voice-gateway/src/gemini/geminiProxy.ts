/**
 * geminiProxy.ts — Gemini Live WebSocket proxy for Buddy credit interviews.
 */

import { WebSocket as WsClient, WebSocketServer } from "ws";
import type { WebSocket as WsServer, RawData } from "ws";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import { GoogleAuth } from "google-auth-library";
import { supabase } from "../lib/supabase.js";
import { env, envOptional } from "../lib/env.js";
import { routeBuddyIntent } from "../dispatch/buddyDispatch.js";

const GCP_PROJECT_ID = env("GCP_PROJECT_ID");
const GCP_LOCATION = envOptional("GCP_LOCATION") ?? "us-central1";
const VERTEX_AI_HOST = `${GCP_LOCATION}-aiplatform.googleapis.com`;
const VERTEX_WS_URL =
  `wss://${VERTEX_AI_HOST}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;

const KEEPALIVE_INTERVAL_MS = 30_000;

const BUDDY_QUERY_TOOL = {
  function_declarations: [
    {
      name: "buddy_query",
      description:
        "Resolve a gap or record a confirmed fact from the banker's answer. Use this whenever the banker provides a specific verifiable fact (dollar amount, date, percentage, name, address). Only objective, documentable facts. No subjective impressions.",
      parameters: {
        type: "OBJECT",
        properties: {
          intent: {
            type: "STRING",
            description:
              "The banker's answer as a structured fact. Examples: 'confirm DSCR 4.27x', 'record occupancy rate 87%', 'confirm fleet size 28 vessels', 'record collateral appraised value 2400000', 'confirm business start date 2017'",
          },
          gap_id: {
            type: "STRING",
            description: "Optional. The gap_queue ID this answer resolves.",
          },
          fact_key: {
            type: "STRING",
            description: "Optional. The specific fact key being confirmed (e.g. OCCUPANCY_RATE, FLEET_SIZE).",
          },
          value: {
            type: "STRING",
            description: "Optional. The raw value as a string (numeric or text).",
          },
        },
        required: ["intent"],
      },
    },
  ],
};

let authClient: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth {
  if (authClient) return authClient;
  const keyBase64 = envOptional("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (keyBase64) {
    const keyJson = JSON.parse(Buffer.from(keyBase64, "base64").toString("utf8"));
    authClient = new GoogleAuth({
      credentials: keyJson,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  } else {
    authClient = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return authClient;
}

async function getAccessToken(): Promise<string> {
  const auth = getAuthClient();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) throw new Error("Failed to obtain GCP access token");
  return tokenResponse.token;
}

interface SessionMetadata {
  proxyToken?: string;
  proxyTokenExpiresAt?: string;
  proxyUserId?: string;
  proxyTraceId?: string;
  proxyDealId?: string;
  proxyBankId?: string;
  proxyModel?: string;
  proxyVoice?: string;
  proxySystemInstruction?: string;
  proxyThinkingBudget?: number;
  proxyProactiveAudio?: boolean;
  [key: string]: unknown;
}

export async function handleGeminiProxy(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): Promise<void> {
  const wss = new WebSocketServer({ noServer: true });

  const clientWs = await new Promise<WsServer>((resolve) => {
    wss.handleUpgrade(req, socket, head, (ws: WsServer) => resolve(ws));
  });

  const url = new URL(req.url || "", `http://localhost`);
  const token = url.searchParams.get("token");
  const sessionId = url.searchParams.get("sessionId");

  if (!token || !sessionId) {
    console.error("[BUDDY_PROXY] Missing token or sessionId");
    clientWs.close(4001, "missing_params");
    return;
  }

  let metadata: SessionMetadata;
  try {
    const { data, error } = await supabase
      .from("deal_voice_sessions")
      .select("metadata")
      .eq("id", sessionId)
      .eq("state", "active")
      .maybeSingle();

    if (error || !data) {
      console.error("[BUDDY_PROXY] Session not found", { sessionId });
      clientWs.close(4001, "session_not_found");
      return;
    }

    metadata = (data.metadata ?? {}) as SessionMetadata;

    if (metadata.proxyToken !== token) {
      console.error("[BUDDY_PROXY] Token mismatch", { sessionId });
      clientWs.close(4001, "invalid_token");
      return;
    }

    if (metadata.proxyTokenExpiresAt) {
      if (Date.now() > new Date(metadata.proxyTokenExpiresAt).getTime()) {
        console.error("[BUDDY_PROXY] Token expired", { sessionId });
        clientWs.close(4001, "token_expired");
        return;
      }
    }
  } catch (err) {
    console.error("[BUDDY_PROXY] Auth error", err);
    clientWs.close(4001, "auth_error");
    return;
  }

  const userId = metadata.proxyUserId ?? "unknown";
  const dealId = metadata.proxyDealId ?? "unknown";
  const bankId = metadata.proxyBankId ?? "unknown";
  const traceId = metadata.proxyTraceId ?? "unknown";

  console.log("[BUDDY_PROXY] CONNECT", { userId, dealId, sessionId, traceId });

  let upstreamWs: WsClient;
  try {
    const accessToken = await getAccessToken();
    upstreamWs = new WsClient(VERTEX_WS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error("[BUDDY_PROXY] Failed to open upstream WS", err);
    clientWs.close(4002, "upstream_connect_failed");
    return;
  }

  let upstreamReady = false;
  let clientClosed = false;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const setupMessage = buildSetupMessage(metadata);

  upstreamWs.on("open", () => {
    upstreamReady = true;
    console.log("[BUDDY_PROXY] Upstream connected", { sessionId, traceId });

    try {
      upstreamWs.send(JSON.stringify(setupMessage));
      console.log("[BUDDY_PROXY] Setup sent", { model: metadata.proxyModel });
    } catch (err) {
      console.error("[BUDDY_PROXY] Setup send failed", err);
      clientWs.close(4002, "setup_failed");
      upstreamWs.close();
      return;
    }

    pingInterval = setInterval(() => {
      if (upstreamWs.readyState === WsClient.OPEN) upstreamWs.ping();
    }, KEEPALIVE_INTERVAL_MS);
  });

  upstreamWs.on("message", (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      if (clientWs.readyState === clientWs.OPEN) clientWs.send(data, { binary: true });
      return;
    }

    const text = typeof data === "string" ? data : (data as Buffer).toString("utf8");
    let parsed: Record<string, unknown> | null = null;

    try { parsed = JSON.parse(text); } catch {
      if (clientWs.readyState === clientWs.OPEN) clientWs.send(data, { binary: false });
      return;
    }

    if (parsed?.toolCall) {
      const toolCall = parsed.toolCall as {
        functionCalls?: Array<{ name: string; args?: Record<string, unknown>; id?: string }>;
      };
      const calls = toolCall.functionCalls;

      if (calls && calls.length > 0) {
        const call = calls[0];
        if (call.name === "buddy_query") {
          const intent = String(call.args?.intent ?? "");
          const gapId = call.args?.gap_id ? String(call.args.gap_id) : undefined;
          const factKey = call.args?.fact_key ? String(call.args.fact_key) : undefined;
          const value = call.args?.value ? String(call.args.value) : undefined;

          console.log("[BUDDY_PROXY] Tool call intercepted", { sessionId, intent: intent.slice(0, 80) });

          void handleToolCall(
            call.id ?? call.name,
            call.name,
            intent,
            userId,
            dealId,
            bankId,
            sessionId,
            gapId,
            factKey,
            value,
            upstreamWs,
          );
          return;
        }
      }
    }

    if (clientWs.readyState === clientWs.OPEN) clientWs.send(data, { binary: false });
  });

  upstreamWs.on("close", (code: number, reason: Buffer) => {
    console.log("[BUDDY_PROXY] Upstream closed", { sessionId, code, reason: reason.toString() });
    if (pingInterval) clearInterval(pingInterval);
    if (!clientClosed && clientWs.readyState === clientWs.OPEN) {
      clientWs.close(code === 1000 ? 1000 : 4002, "upstream_closed");
    }
  });

  upstreamWs.on("error", (err: Error) => {
    console.error("[BUDDY_PROXY] Upstream error", { sessionId, error: err.message });
    if (pingInterval) clearInterval(pingInterval);
    if (!clientClosed && clientWs.readyState === clientWs.OPEN) {
      clientWs.close(4002, "upstream_error");
    }
  });

  clientWs.on("message", (data: RawData, isBinary: boolean) => {
    if (upstreamReady && upstreamWs.readyState === WsClient.OPEN) {
      upstreamWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on("close", (code: number) => {
    clientClosed = true;
    console.log("[BUDDY_PROXY] Client closed", { sessionId, traceId, code });
    if (pingInterval) clearInterval(pingInterval);
    if (upstreamWs.readyState === WsClient.OPEN || upstreamWs.readyState === WsClient.CONNECTING) {
      upstreamWs.close();
    }
  });

  clientWs.on("error", (err: Error) => {
    console.error("[BUDDY_PROXY] Client error", { sessionId, error: err.message });
  });
}

async function handleToolCall(
  callId: string,
  callName: string,
  intent: string,
  userId: string,
  dealId: string,
  bankId: string,
  sessionId: string,
  gapId: string | undefined,
  factKey: string | undefined,
  value: string | undefined,
  upstreamWs: WsClient,
): Promise<void> {
  try {
    const result = await routeBuddyIntent({
      intent,
      userId,
      dealId,
      bankId,
      sessionId,
      gapId,
      factKey,
      value,
    });

    const toolResponse = {
      toolResponse: {
        functionResponses: [{
          name: callName,
          response: result.success
            ? { result: JSON.stringify(result.data) }
            : { error: result.error ?? "Intent routing failed." },
        }],
      },
    };

    if (upstreamWs.readyState === WsClient.OPEN) {
      upstreamWs.send(JSON.stringify(toolResponse));
    }
  } catch (err) {
    console.error("[BUDDY_PROXY] Tool call error", { sessionId, error: String(err) });
    const errorResponse = {
      toolResponse: {
        functionResponses: [{
          name: callName,
          response: { error: "Internal tool routing error." },
        }],
      },
    };
    if (upstreamWs.readyState === WsClient.OPEN) {
      upstreamWs.send(JSON.stringify(errorResponse));
    }
  }
}

// ---------------------------------------------------------------------------
// Build Gemini Live setup message
// IMPORTANT: input_audio_transcription and output_audio_transcription must be
// top-level fields in setup, NOT inside generation_config.
// ---------------------------------------------------------------------------

function buildSetupMessage(meta: SessionMetadata): Record<string, unknown> {
  const model = meta.proxyModel ?? "gemini-live-2.5-flash-native-audio";

  const generationConfig: Record<string, unknown> = {
    response_modalities: ["AUDIO"],
    thinking_config: { thinking_budget: meta.proxyThinkingBudget ?? 0 },
  };

  if (meta.proxyVoice) {
    generationConfig.speech_config = {
      voice_config: {
        prebuilt_voice_config: { voice_name: meta.proxyVoice },
      },
    };
  }

  const setup: Record<string, unknown> = {
    model: `projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${model}`,
    generation_config: generationConfig,
    // Transcription fields are TOP-LEVEL in setup, not inside generation_config
    input_audio_transcription: {},
    output_audio_transcription: {},
  };

  if (meta.proxySystemInstruction) {
    setup.system_instruction = {
      parts: [{ text: meta.proxySystemInstruction }],
    };
  }

  if (meta.proxyProactiveAudio !== false) {
    setup.proactivity = { proactive_audio: true };
  }

  setup.tools = [BUDDY_QUERY_TOOL];

  return { setup };
}
