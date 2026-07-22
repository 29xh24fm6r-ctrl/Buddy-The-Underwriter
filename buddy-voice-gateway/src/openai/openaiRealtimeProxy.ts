/**
 * openaiRealtimeProxy.ts — OpenAI Realtime API WebSocket proxy for Buddy voice sessions.
 *
 * Mirrors the previous Gemini Live proxy's responsibilities: validate the
 * short-lived Supabase-backed session token, open an authenticated upstream
 * connection (API key never reaches the browser), configure the session,
 * intercept buddy_query tool calls, and relay everything else untouched.
 */

import { WebSocket as WsClient, WebSocketServer } from "ws";
import type { WebSocket as WsServer, RawData } from "ws";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import { supabase } from "../lib/supabase.js";
import { env } from "../lib/env.js";
import { routeBuddyIntent, routeBorrowerIntent } from "../dispatch/buddyDispatch.js";

const OPENAI_API_KEY = env("OPENAI_API_KEY");
const REALTIME_WS_BASE = "wss://api.openai.com/v1/realtime";

const KEEPALIVE_INTERVAL_MS = 30_000;

const BUDDY_QUERY_TOOL = {
  type: "function",
  name: "buddy_query",
  description:
    "Resolve a gap or record a confirmed fact from the banker's answer. Use this whenever the banker provides a specific verifiable fact (dollar amount, date, percentage, name, address). Only objective, documentable facts. No subjective impressions.",
  parameters: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        description:
          "The banker's answer as a structured fact. Examples: 'confirm DSCR 4.27x', 'record occupancy rate 87%', 'confirm fleet size 28 vessels', 'record collateral appraised value 2400000', 'confirm business start date 2017'",
      },
      gap_id: {
        type: "string",
        description: "Optional. The gap_queue ID this answer resolves.",
      },
      fact_key: {
        type: "string",
        description: "Optional. The specific fact key being confirmed (e.g. OCCUPANCY_RATE, FLEET_SIZE).",
      },
      value: {
        type: "string",
        description: "Optional. The raw value as a string (numeric or text).",
      },
    },
    required: ["intent"],
  },
};

interface SessionMetadata {
  proxyToken?: string;
  proxyTokenExpiresAt?: string;
  proxyUserId?: string;
  proxyTraceId?: string;
  proxyDealId?: string;
  proxyBankId?: string;
  /** 'banker' (default) | 'borrower'. Decides dispatch route. */
  proxyActorScope?: "banker" | "borrower";
  proxyModel?: string;
  proxyVoice?: string;
  proxySystemInstruction?: string;
  [key: string]: unknown;
}

export async function handleOpenAIRealtimeProxy(
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
  const actorScope: "banker" | "borrower" =
    metadata.proxyActorScope === "borrower" ? "borrower" : "banker";
  const isBorrower = actorScope === "borrower";
  const model = metadata.proxyModel ?? "gpt-realtime";

  // call_id -> function name, populated as soon as the model starts a
  // function_call output item. response.function_call_arguments.done does
  // not itself carry the function name, so we track it here.
  const callNamesById = new Map<string, string>();
  let initialResponseTriggered = false;

  console.log("[BUDDY_PROXY] CONNECT", {
    userId,
    dealId,
    sessionId,
    traceId,
    actorScope,
    model,
  });

  let upstreamWs: WsClient;
  try {
    upstreamWs = new WsClient(`${REALTIME_WS_BASE}?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
  } catch (err) {
    console.error("[BUDDY_PROXY] Failed to open upstream WS", err);
    clientWs.close(4002, "upstream_connect_failed");
    return;
  }

  let upstreamReady = false;
  let clientClosed = false;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const sessionUpdate = buildSessionUpdateMessage(metadata);

  upstreamWs.on("open", () => {
    upstreamReady = true;
    console.log("[BUDDY_PROXY] Upstream connected", { sessionId, traceId });

    try {
      upstreamWs.send(JSON.stringify(sessionUpdate));
      console.log("[BUDDY_PROXY] session.update sent", { model });
    } catch (err) {
      console.error("[BUDDY_PROXY] session.update send failed", err);
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

    const type = parsed?.type as string | undefined;

    // Track function-call item names as soon as the output item appears.
    if ((type === "response.output_item.added" || type === "response.output_item.done")) {
      const item = (parsed as any).item;
      if (item?.type === "function_call" && item.call_id && item.name) {
        callNamesById.set(item.call_id, item.name);
      }
    }

    // Buddy speaks first — kick off the opening turn once our session
    // config (persona, tools, voice) has been acknowledged upstream.
    if (type === "session.updated" && !initialResponseTriggered) {
      initialResponseTriggered = true;
      if (upstreamWs.readyState === WsClient.OPEN) {
        upstreamWs.send(JSON.stringify({ type: "response.create" }));
      }
    }

    if (type === "response.function_call_arguments.done") {
      const callId = String((parsed as any).call_id ?? "");
      const callName = callNamesById.get(callId) ?? "buddy_query";
      const argsJson = String((parsed as any).arguments ?? "{}");

      let args: Record<string, unknown> = {};
      try { args = JSON.parse(argsJson); } catch { /* leave empty */ }

      if (isBorrower) {
        // Sprint 2: borrower tool calls audit via brokerage dispatch route;
        // they are NOT trusted for fact writes (the dispatch route treats
        // tool_call as audit-only per S2-2). We still ack upstream so the
        // model doesn't wait on a tool response.
        void routeBorrowerIntent({
          sessionId,
          intent: "tool_call",
          toolName: callName,
          args,
        }).catch((err) =>
          console.warn("[BUDDY_PROXY] borrower tool_call dispatch failed", err),
        );
        sendFunctionCallOutput(upstreamWs, callId, { result: "audited" });
      } else if (callName === "buddy_query") {
        const intent = String(args.intent ?? "");
        const gapId = args.gap_id ? String(args.gap_id) : undefined;
        const factKey = args.fact_key ? String(args.fact_key) : undefined;
        const value = args.value ? String(args.value) : undefined;

        console.log("[BUDDY_PROXY] Tool call intercepted", { sessionId, intent: intent.slice(0, 80) });

        void handleFunctionCall(
          callId,
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
      }
    }

    // Borrower-scope transcript dispatch. Each of these events already
    // carries the complete utterance text — no cross-fragment buffering
    // needed (unlike the old Gemini turnComplete accumulation).
    if (isBorrower && type === "conversation.item.input_audio_transcription.completed") {
      const borrowerText = String((parsed as any).transcript ?? "").trim();
      if (borrowerText) {
        void routeBorrowerIntent({
          sessionId,
          intent: "utterance",
          speaker: "borrower",
          text: borrowerText,
        }).catch((err) =>
          console.warn("[BUDDY_PROXY] borrower utterance dispatch failed", err),
        );
      }
    }

    // GA gpt-realtime renamed this from response.audio_transcript.done to
    // response.output_audio_transcript.done (confirmed against OpenAI's own
    // openai-python example, examples/realtime/push_to_talk_app.py). The old
    // name never fired, so borrower sessions were silently missing every
    // assistant-side fact Buddy's own speech might have surfaced.
    if (isBorrower && type === "response.output_audio_transcript.done") {
      const assistantText = String((parsed as any).transcript ?? "").trim();
      if (assistantText) {
        void routeBorrowerIntent({
          sessionId,
          intent: "utterance",
          speaker: "assistant",
          text: assistantText,
        }).catch((err) =>
          console.warn("[BUDDY_PROXY] assistant utterance dispatch failed", err),
        );
      }
    }

    if (type === "error") {
      console.error("[BUDDY_PROXY] Upstream error event", { sessionId, error: (parsed as any).error });
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
    // Sprint 2: flag session_ended for borrower sessions.
    if (isBorrower) {
      void routeBorrowerIntent({
        sessionId,
        intent: "session_ended",
        reason: `client_close_${code}`,
      }).catch((err) =>
        console.warn("[BUDDY_PROXY] borrower session_ended dispatch failed", err),
      );
    }
  });

  clientWs.on("error", (err: Error) => {
    console.error("[BUDDY_PROXY] Client error", { sessionId, error: err.message });
    if (isBorrower) {
      void routeBorrowerIntent({
        sessionId,
        intent: "error",
        error: err.message,
      }).catch(() => {});
    }
  });
}

function sendFunctionCallOutput(
  upstreamWs: WsClient,
  callId: string,
  output: Record<string, unknown>,
): void {
  if (upstreamWs.readyState !== WsClient.OPEN) return;
  upstreamWs.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(output),
    },
  }));
  // Function call outputs don't auto-trigger a response — ask the model
  // to continue the conversation now that it has the result.
  upstreamWs.send(JSON.stringify({ type: "response.create" }));
}

async function handleFunctionCall(
  callId: string,
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

    sendFunctionCallOutput(
      upstreamWs,
      callId,
      result.success
        ? { result: JSON.stringify(result.data) }
        : { error: result.error ?? "Intent routing failed." },
    );
  } catch (err) {
    console.error("[BUDDY_PROXY] Tool call error", { sessionId, error: String(err) });
    sendFunctionCallOutput(upstreamWs, callId, { error: "Internal tool routing error." });
  }
}

// ---------------------------------------------------------------------------
// Build the OpenAI Realtime session.update event. The model is fixed at
// connect time via the WS URL query param — it (and voice) cannot be
// changed by a later session.update, so neither is included here.
// ---------------------------------------------------------------------------

function buildSessionUpdateMessage(meta: SessionMetadata): Record<string, unknown> {
  const session: Record<string, unknown> = {
    type: "realtime",
    output_modalities: ["audio"],
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        turn_detection: {
          type: "server_vad",
          create_response: true,
          interrupt_response: true,
        },
        transcription: { model: "gpt-4o-mini-transcribe" },
      },
      output: {
        format: { type: "audio/pcm", rate: 24000 },
        voice: meta.proxyVoice ?? "marin",
      },
    },
    tools: [BUDDY_QUERY_TOOL],
    tool_choice: "auto",
  };

  if (meta.proxySystemInstruction) {
    session.instructions = meta.proxySystemInstruction;
  }

  return { type: "session.update", session };
}
