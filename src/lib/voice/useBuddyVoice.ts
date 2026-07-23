"use client";

/**
 * useBuddyVoice — OpenAI Realtime API voice hook for Buddy concierge
 * sessions (banker credit interviews + brokerage borrower calls).
 *
 * SPEC-BUDDY-VOICE-WEBRTC: connects directly browser<->OpenAI over WebRTC
 * instead of relaying through buddy-voice-gateway over WebSocket. Per
 * OpenAI's own guidance for browser clients, WebRTC's Opus codec +
 * congestion control makes it resilient to real-world network conditions
 * in a way a WS relay isn't, and the server manages the output audio
 * buffer directly — interruption/truncation is automatic, not something
 * this hook has to hand-roll (the old WS implementation's
 * playAudioChunk/cancelAudioPlayback/activeAudioSourcesRef/
 * playbackGenerationRef machinery, and the AudioWorklet mic-capture path,
 * are gone entirely — WebRTC's native audio pipeline replaces all of it).
 *
 * Architecture:
 *   - POST {tokenEndpoint} → { clientSecret, sessionId, actorScope, ... }
 *     (ephemeral OpenAI Realtime client_secret, 60s TTL — mirrors the
 *     existing pattern in src/app/api/deals/[dealId]/voice/token/route.ts
 *     and src/components/deals/VoiceInterviewButton.tsx)
 *   - RTCPeerConnection directly against OpenAI's Realtime API
 *     (https://api.openai.com/v1/realtime/calls) — mic via addTrack,
 *     playback via a native <audio> element fed by pc.ontrack
 *   - Data channel ("oai-events") carries the same Realtime event schema
 *     as the old WS relay (GA event names — see handleDataChannelMessage)
 *   - buddy_query tool calls: this hook cannot execute them itself (the
 *     browser must never write facts unsupervised) — it POSTs the call to
 *     a server-side dispatch route, then relays the server's result back
 *     onto its own data channel as function_call_output + response.create.
 *     Banker calls are trusted for fact writes (server re-derives
 *     userId/bankId from the caller's own authenticated session, never
 *     trusts client-supplied identity); borrower calls remain audit-only,
 *     matching the S2-2 invariant unchanged from the WS-relay era.
 *
 * Same public return shape as the WS-relay version. Drop-in for
 * BankerVoicePanel / BorrowerVoicePanel.
 */

import { useRef, useState, useCallback, useEffect } from "react";

type VoiceStatus =
  | "idle" | "connecting" | "listening"
  | "speaking" | "processing" | "error" | "reconnecting";

type ActorScope = "banker" | "borrower";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface UseBuddyVoiceOptions {
  dealId: string;
  /**
   * Sprint 2: token endpoint to POST. Default is the banker voice route
   * for backward-compat with BankerVoicePanel. The brokerage borrower
   * panel passes `/api/brokerage/voice/realtime-token`.
   */
  tokenEndpoint?: string;
  onStatusChange?: (status: VoiceStatus) => void;
  onMessage?: (msg: Message) => void;
  onGapResolved?: (factKey: string) => void;
}

let counter = 0;
function mkMsg(role: "user" | "assistant", content: string): Message {
  return { id: `bv-${++counter}-${Date.now()}`, role, content, timestamp: new Date() };
}

export function useBuddyVoice(options: UseBuddyVoiceOptions) {
  const { dealId, tokenEndpoint, onStatusChange, onMessage, onGapResolved } = options;

  const [status, setStatusRaw] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const connectedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const connectAttemptIdRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const actorScopeRef = useRef<ActorScope>("banker");
  const callNamesByIdRef = useRef<Map<string, string>>(new Map());
  const statusRef = useRef<VoiceStatus>("idle");

  const setStatus = useCallback((s: VoiceStatus) => {
    statusRef.current = s;
    setStatusRaw(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const pushMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
    onMessage?.(msg);
  }, [onMessage]);

  // ---- Tool-call relay ----
  // response.function_call_arguments.done lands on this hook's own data
  // channel — it must not execute the call itself (that would let any
  // client fabricate fact writes). POST it to the same dispatch route the
  // Fly gateway used to call server-to-server, now authenticated by the
  // caller's own session cookie instead of a shared gateway secret, then
  // relay the server's answer back onto the data channel as the model's
  // function_call_output.
  const sendFunctionCallOutput = useCallback((callId: string, output: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
    }));
    // Function call outputs don't auto-trigger a response — ask the model
    // to continue the conversation now that it has the result.
    dc.send(JSON.stringify({ type: "response.create" }));
  }, []);

  const handleFunctionCall = useCallback(async (callId: string, callName: string, argsJson: string) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(argsJson); } catch { /* leave empty */ }

    if (args?.fact_key && onGapResolved) onGapResolved(String(args.fact_key));

    const sessionId = sessionIdRef.current;
    if (actorScopeRef.current === "borrower") {
      // Sprint 2 / S2-2: borrower tool calls audit via the brokerage
      // dispatch route; they are NOT trusted for fact writes. Fire the
      // audit without awaiting it (matches the old gateway's
      // fire-and-forget timing) and ack the model immediately.
      void fetch(`/api/brokerage/voice/${sessionId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ intent: "tool_call", toolName: callName, args }),
      }).catch((err) => console.warn("[BUDDY_VOICE] borrower tool_call relay failed", err));
      sendFunctionCallOutput(callId, { result: "audited" });
      return;
    }

    if (callName !== "buddy_query") return;

    try {
      const res = await fetch(`/api/deals/${dealId}/banker-session/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          intent: String(args.intent ?? ""),
          sessionId,
          gapId: args.gap_id,
          factKey: args.fact_key,
          value: args.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      sendFunctionCallOutput(
        callId,
        data?.ok ? { result: data.message ?? "confirmed" } : { error: data?.error ?? "dispatch_failed" },
      );
    } catch (err) {
      console.error("[BUDDY_VOICE] banker tool_call relay failed", err);
      sendFunctionCallOutput(callId, { error: "Internal tool routing error." });
    }
  }, [dealId, onGapResolved, sendFunctionCallOutput]);

  // Borrower-scope utterance relay. Each of these events already carries
  // the complete utterance text — mirrors what the gateway used to
  // forward server-side; now the browser is the only thing that ever
  // sees these events, so it has to make the call itself.
  const relayBorrowerUtterance = useCallback((speaker: "borrower" | "assistant", text: string) => {
    if (actorScopeRef.current !== "borrower" || !text.trim()) return;
    const sessionId = sessionIdRef.current;
    void fetch(`/api/brokerage/voice/${sessionId}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ intent: "utterance", speaker, text }),
    }).catch((err) => console.warn(`[BUDDY_VOICE] borrower ${speaker} utterance relay failed`, err));
  }, []);

  // ---- Data channel message handler (OpenAI Realtime events over WebRTC) ----

  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(typeof event.data === "string" ? event.data : "");
      const item = data?.item;

      // Track function-call item names as soon as the output item appears
      // — response.function_call_arguments.done doesn't itself carry the
      // function name.
      if ((data.type === "response.output_item.added" || data.type === "response.output_item.done")) {
        if (item?.type === "function_call" && item.call_id && item.name) {
          callNamesByIdRef.current.set(item.call_id, item.name);
        }
      }

      switch (data.type) {
        case "session.created":
        case "session.updated":
          // Session config (persona, tools, voice) is embedded in the
          // ephemeral client_secret at mint time for WebRTC — there's no
          // separate session.update round trip to wait on. dc.onopen is
          // the readiness signal (see connectInternal).
          return;

        // WebRTC/SIP-specific: the server manages the output audio buffer
        // directly and emits these around actual playback start/stop —
        // far more reliable than trying to infer speaking state from
        // audio chunk scheduling, which is what the old WS implementation
        // had to do by hand.
        case "output_audio_buffer.started":
          setIsAssistantSpeaking(true);
          setStatus("speaking");
          return;

        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          setIsAssistantSpeaking(false);
          if (connectedRef.current) setStatus("listening");
          return;

        case "response.output_audio_transcript.delta":
          if (typeof data.delta === "string") setCurrentTranscript(prev => prev + data.delta);
          return;

        case "response.output_audio_transcript.done": {
          const text = String(data.transcript ?? "").trim();
          setCurrentTranscript("");
          if (text) pushMessage(mkMsg("assistant", text));
          relayBorrowerUtterance("assistant", text);
          return;
        }

        case "conversation.item.input_audio_transcription.completed": {
          setIsUserSpeaking(false);
          const text = String(data.transcript ?? "").trim();
          if (text) pushMessage(mkMsg("user", text));
          relayBorrowerUtterance("borrower", text);
          return;
        }

        case "input_audio_buffer.speech_started":
          // No manual playback cancellation here — under WebRTC the
          // server truncates/stops the output audio buffer itself on
          // interruption (turn_detection.interrupt_response, set at mint
          // time). output_audio_buffer.stopped fires on its own.
          setIsUserSpeaking(true);
          return;

        case "input_audio_buffer.speech_stopped":
          return;

        case "response.function_call_arguments.done": {
          setStatus("processing");
          const callId = String(data.call_id ?? "");
          const callName = callNamesByIdRef.current.get(callId) ?? "buddy_query";
          void handleFunctionCall(callId, callName, String(data.arguments ?? "{}"));
          return;
        }

        case "error":
          console.warn("[BUDDY_VOICE] Realtime error event", data.error);
          if (data.error?.message) setError(String(data.error.message));
          return;

        default:
          return;
      }
    } catch (e) {
      console.warn("[BUDDY_VOICE] Data channel message parse error", e);
    }
  }, [setStatus, pushMessage, relayBorrowerUtterance, handleFunctionCall]);

  // ---- Teardown ----

  const teardownConnection = useCallback(() => {
    try { dcRef.current?.close(); } catch { }
    dcRef.current = null;

    try {
      pcRef.current?.getSenders().forEach((s) => { try { s.track?.stop(); } catch { } });
      pcRef.current?.close();
    } catch { }
    pcRef.current = null;

    if (audioElRef.current) {
      try { audioElRef.current.pause(); audioElRef.current.srcObject = null; } catch { }
      audioElRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    callNamesByIdRef.current.clear();
  }, []);

  // ---- Connect ----

  const connectInternal = useCallback(async () => {
    connectAttemptIdRef.current++;
    const attemptId = connectAttemptIdRef.current;

    setStatus("connecting");
    setError(null);

    try {
      teardownConnection();

      const endpoint = tokenEndpoint ?? `/api/deals/${dealId}/banker-session/realtime-token`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include", // S2-1: borrower cookie rides along
      });
      const data = await res.json();

      if (attemptId !== connectAttemptIdRef.current) return;

      if (!data.ok || !data.clientSecret || !data.sessionId) {
        setError(data.error ?? "Failed to get voice token.");
        setStatus("error");
        return;
      }

      sessionIdRef.current = data.sessionId;
      actorScopeRef.current = data.actorScope === "borrower" ? "borrower" : "banker";

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attemptId !== connectAttemptIdRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

      const [track] = stream.getAudioTracks();
      pc.addTrack(track, stream);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = handleDataChannelMessage;

      dc.onopen = () => {
        if (attemptId !== connectAttemptIdRef.current) return;
        connectedRef.current = true;
        setStatus("listening");
        // Buddy speaks first — the session's instructions describe the
        // opening move (summarize the deal / greet warmly); this just
        // triggers the model to actually produce that first turn.
        if (dc.readyState === "open") dc.send(JSON.stringify({ type: "response.create" }));
      };

      pc.onconnectionstatechange = () => {
        if (attemptId !== connectAttemptIdRef.current) return;
        if (stopRequestedRef.current) return;
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          connectedRef.current = false;
          if (statusRef.current !== "error") {
            setError("Voice connection lost.");
            setStatus("error");
          }
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${data.clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });

      if (attemptId !== connectAttemptIdRef.current) return;

      if (!sdpRes.ok) {
        const detail = await sdpRes.text().catch(() => "");
        throw new Error(`Realtime SDP exchange failed: ${sdpRes.status} ${detail}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (e: unknown) {
      if (attemptId !== connectAttemptIdRef.current) return;
      const msg = e instanceof Error
        ? (e.name === "NotAllowedError" ? "Microphone access denied." : e.message)
        : "Connection failed.";
      setError(msg);
      setStatus("error");
      teardownConnection();
    }
  }, [dealId, tokenEndpoint, setStatus, teardownConnection, handleDataChannelMessage]);

  const connect = useCallback(async () => {
    if (connectedRef.current) return;
    stopRequestedRef.current = false;
    setMessages([]);
    setCurrentTranscript("");
    await connectInternal();
  }, [connectInternal]);

  const disconnect = useCallback(() => {
    stopRequestedRef.current = true;
    const wasConnected = connectedRef.current;
    connectedRef.current = false;

    if (wasConnected && actorScopeRef.current === "borrower" && sessionIdRef.current) {
      void fetch(`/api/brokerage/voice/${sessionIdRef.current}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ intent: "session_ended", reason: "client_disconnect" }),
      }).catch(() => {});
    }

    teardownConnection();
    sessionIdRef.current = null;
    setStatus("idle");
    setError(null);
    setIsUserSpeaking(false);
    setIsAssistantSpeaking(false);
    setCurrentTranscript("");
    setTimeout(() => { stopRequestedRef.current = false; }, 0);
  }, [setStatus, teardownConnection]);

  const sendTextMessage = useCallback((text: string) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open" || !text.trim()) return;
    pushMessage(mkMsg("user", text));
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    }));
    dc.send(JSON.stringify({ type: "response.create" }));
    setStatus("processing");
  }, [setStatus, pushMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { teardownConnection(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConnected = ["listening", "speaking", "processing", "reconnecting"].includes(status);

  return {
    status, error, messages, currentTranscript,
    isUserSpeaking, isAssistantSpeaking, isConnected,
    connect, disconnect, sendTextMessage,
  };
}
