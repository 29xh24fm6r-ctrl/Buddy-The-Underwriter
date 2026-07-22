"use client";

/**
 * useBuddyVoice — OpenAI Realtime API voice hook for banker credit interviews.
 *
 * Architecture:
 *   - POST /api/deals/[dealId]/banker-session/realtime-token → proxyToken + sessionId
 *   - WebSocket to buddy-voice-gateway /realtime?token=TOKEN&sessionId=ID
 *   - Gateway relays to OpenAI's Realtime API (gpt-realtime, API key stays server-side)
 *   - Mic: 24kHz PCM16 via AudioWorklet (buddy-mic-processor.js)
 *   - Audio out: 24kHz PCM16 via AudioContext
 *   - Tool calls intercepted by gateway → writes to deal_financial_facts
 *
 * Same return shape as before. Drop-in for DealHealthPanel.
 */

import { useRef, useState, useCallback, useEffect } from "react";

const GATEWAY_WS_BASE =
  process.env.NEXT_PUBLIC_BUDDY_VOICE_GATEWAY_URL ?? "ws://localhost:8080";

const INPUT_SAMPLE_RATE = 24000;
const MAX_EARLY_CLOSE_RETRIES = 2;
const EARLY_CLOSE_BACKOFF = [150, 350, 700];

type VoiceStatus =
  | "idle" | "connecting" | "listening"
  | "speaking" | "processing" | "error" | "reconnecting";

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

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const connectedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const connectAttemptIdRef = useRef(0);
  const earlyCloseRetryRef = useRef(0);
  const nextPlayTimeRef = useRef(0);
  // Every response.output_audio.delta chunk gets its own AudioBufferSourceNode
  // scheduled back-to-back via nextPlayTimeRef. A single pendingAudioRef can
  // only ever remember the LAST chunk created — every earlier chunk already
  // playing or queued ahead in the Web Audio timeline becomes untracked and
  // uncancellable the moment a newer chunk arrives. On barge-in (the user
  // starts talking mid-response), that meant only the most recent chunk got
  // stopped while the rest of the interrupted response kept playing under
  // the next response's freshly scheduled audio — the "talking over itself"
  // bug. Track every active node instead, tagged with a playback generation
  // so a stale response's onended callback can't clobber a newer response's
  // speaking state.
  const activeAudioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playbackGenerationRef = useRef(0);
  const isAssistantSpeakingRef = useRef(false);
  const sessionConfigRef = useRef<{ outputSampleRate: number } | null>(null);
  const statusRef = useRef<VoiceStatus>("idle");
  const connectInternalRef = useRef<() => Promise<void>>(async () => {});
  const startMicCaptureRef = useRef<(stream: MediaStream) => Promise<void>>(async () => {});

  const setStatus = useCallback((s: VoiceStatus) => {
    statusRef.current = s;
    setStatusRaw(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const pushMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
    onMessage?.(msg);
  }, [onMessage]);

  // ---- Audio playback (24kHz PCM16) ----

  const playAudioChunk = useCallback(async (base64Data: string) => {
    try {
      if (!playbackCtxRef.current) {
        playbackCtxRef.current = new AudioContext({
          sampleRate: sessionConfigRef.current?.outputSampleRate ?? 24000,
        });
      }
      const ctx = playbackCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      const generation = playbackGenerationRef.current;

      const sampleRate = sessionConfigRef.current?.outputSampleRate ?? 24000;
      const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

      const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      activeAudioSourcesRef.current.add(source);
      isAssistantSpeakingRef.current = true;
      setIsAssistantSpeaking(true);
      setStatus("speaking");

      source.onended = () => {
        activeAudioSourcesRef.current.delete(source);
        // A chunk from an interrupted response can still fire onended after
        // cancelAudioPlayback bumps the generation — ignore it so it can't
        // report "done speaking" on behalf of whatever response came next.
        if (generation !== playbackGenerationRef.current) return;
        if (activeAudioSourcesRef.current.size === 0) {
          isAssistantSpeakingRef.current = false;
          setIsAssistantSpeaking(false);
          if (connectedRef.current) setStatus("listening");
        }
      };

      const now = ctx.currentTime;
      const startAt = Math.max(now, nextPlayTimeRef.current);
      source.start(startAt);
      nextPlayTimeRef.current = startAt + audioBuffer.duration;
    } catch (e) {
      console.error("[BUDDY_VOICE] Audio playback error", e);
    }
  }, [setStatus]);

  const cancelAudioPlayback = useCallback(() => {
    playbackGenerationRef.current++;
    for (const source of activeAudioSourcesRef.current) {
      try { source.stop(); } catch { }
    }
    activeAudioSourcesRef.current.clear();
    nextPlayTimeRef.current = 0;
    isAssistantSpeakingRef.current = false;
    setIsAssistantSpeaking(false);
  }, []);

  // ---- WS message handler (OpenAI Realtime events) ----

  const handleWsMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(
        typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data)
      );

      switch (data.type) {
        case "session.created":
          return;

        case "session.updated":
          connectedRef.current = true;
          setStatus("listening");
          if (streamRef.current) void startMicCaptureRef.current(streamRef.current);
          return;

        // GA gpt-realtime (shipped Aug 2025) renamed these from the beta-era
        // response.audio.* / response.audio_transcript.* to
        // response.output_audio.* / response.output_audio_transcript.* —
        // confirmed against OpenAI's own openai-python example
        // (examples/realtime/push_to_talk_app.py). The old names never fire,
        // which is why Buddy generated audio server-side but the browser
        // never played it or rendered a transcript.
        case "response.output_audio.delta":
          if (typeof data.delta === "string") void playAudioChunk(data.delta);
          return;

        case "response.output_audio_transcript.delta":
          if (typeof data.delta === "string") setCurrentTranscript(prev => prev + data.delta);
          return;

        case "response.output_audio_transcript.done": {
          const text = String(data.transcript ?? "").trim();
          setCurrentTranscript("");
          if (text) pushMessage(mkMsg("assistant", text));
          return;
        }

        case "conversation.item.input_audio_transcription.completed": {
          setIsUserSpeaking(false);
          const text = String(data.transcript ?? "").trim();
          if (text) pushMessage(mkMsg("user", text));
          return;
        }

        case "input_audio_buffer.speech_started":
          setIsUserSpeaking(true);
          cancelAudioPlayback();
          return;

        case "input_audio_buffer.speech_stopped":
          return;

        case "response.function_call_arguments.done": {
          setStatus("processing");
          try {
            const args = JSON.parse(String(data.arguments ?? "{}"));
            if (args?.fact_key && onGapResolved) onGapResolved(String(args.fact_key));
          } catch { /* non-JSON args — nothing to extract */ }
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
      console.warn("[BUDDY_VOICE] Message parse error", e);
    }
  }, [setStatus, playAudioChunk, cancelAudioPlayback, pushMessage, onGapResolved]);

  // ---- Mic capture (24kHz AudioWorklet) ----

  const startMicCapture = useCallback(async (stream: MediaStream) => {
    try {
      if (!captureCtxRef.current) {
        captureCtxRef.current = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      }
      const ctx = captureCtxRef.current;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      await ctx.audioWorklet.addModule("/audio/buddy-mic-processor.js");
      const worklet = new AudioWorkletNode(ctx, "buddy-mic-processor");
      workletRef.current = worklet;

      worklet.port.onmessage = (evt) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const int16 = new Int16Array(evt.data as ArrayBuffer);
        const bytes = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        wsRef.current.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64,
        }));
      };

      source.connect(worklet);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      worklet.connect(silentGain);
      silentGain.connect(ctx.destination);
    } catch (e) {
      console.error("[BUDDY_VOICE] Mic capture error", e);
    }
  }, []);

  // Sync ref outside render (lint: no-ref-in-render).
  // Behavior preserved: ref points at the latest startMicCapture each commit,
  // same as the previous in-render assignment.
  useEffect(() => {
    startMicCaptureRef.current = startMicCapture;
  }, [startMicCapture]);

  const stopMicCapture = useCallback(() => {
    try { if (workletRef.current) { workletRef.current.disconnect(); workletRef.current = null; } } catch { }
    try { if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; } } catch { }
    setIsUserSpeaking(false);
  }, []);

  const hardCloseWebSocket = useCallback((reason: string) => {
    const ws = wsRef.current;
    if (!ws) return;
    try {
      ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null;
      ws.close();
    } catch { }
    wsRef.current = null;
  }, []);

  // ---- Connect ----

  const connectInternal = useCallback(async () => {
    connectAttemptIdRef.current++;
    const attemptId = connectAttemptIdRef.current;

    setStatus("connecting");
    setError(null);

    try {
      hardCloseWebSocket("restart");

      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: INPUT_SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      }

      if (attemptId !== connectAttemptIdRef.current) return;

      const endpoint =
        tokenEndpoint ?? `/api/deals/${dealId}/banker-session/realtime-token`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include", // S2-1: borrower cookie rides along
      });

      const data = await res.json();

      if (attemptId !== connectAttemptIdRef.current) return;

      if (!data.ok || !data.proxyToken || !data.sessionId) {
        setError(data.error ?? "Failed to get voice token.");
        setStatus("error");
        return;
      }

      sessionConfigRef.current = data.config ?? null;

      const wsUrl = `${GATEWAY_WS_BASE}/realtime?token=${encodeURIComponent(data.proxyToken)}&sessionId=${encodeURIComponent(data.sessionId)}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      let opened = false;

      ws.onopen = () => {
        if (attemptId !== connectAttemptIdRef.current) return;
        opened = true;
        earlyCloseRetryRef.current = 0;
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = () => {
        if (attemptId !== connectAttemptIdRef.current) return;
        setError("WebSocket connection error.");
        setStatus("error");
        connectedRef.current = false;
      };

      ws.onclose = (ev) => {
        if (attemptId !== connectAttemptIdRef.current) return;
        if (stopRequestedRef.current) return;

        if (!opened && ev.code !== 1000 && earlyCloseRetryRef.current < MAX_EARLY_CLOSE_RETRIES) {
          earlyCloseRetryRef.current++;
          const delay = EARLY_CLOSE_BACKOFF[earlyCloseRetryRef.current - 1] ?? 700;
          setTimeout(() => { if (!stopRequestedRef.current) void connectInternalRef.current(); }, delay);
          return;
        }

        connectedRef.current = false;
        stopMicCapture();
        if (statusRef.current !== "error") setStatus("idle");
      };
    } catch (e: unknown) {
      if (attemptId !== connectAttemptIdRef.current) return;
      const msg = e instanceof Error
        ? (e.name === "NotAllowedError" ? "Microphone access denied." : e.message)
        : "Connection failed.";
      setError(msg);
      setStatus("error");
    }
    // tokenEndpoint is read on line ~288 to override the default endpoint.
    // Adding it to deps keeps the React Compiler's manual memoization
    // analysis honest (preserve-manual-memoization). When tokenEndpoint
    // changes, a new connectInternal closure captures the new value —
    // identical to the previous behavior, just deps now match the body.
  }, [dealId, tokenEndpoint, setStatus, hardCloseWebSocket, handleWsMessage, stopMicCapture]);

  // Sync ref outside render (lint: no-ref-in-render).
  // Behavior preserved: ref points at the latest connectInternal each commit,
  // same as the previous in-render assignment.
  useEffect(() => {
    connectInternalRef.current = connectInternal;
  }, [connectInternal]);

  const connect = useCallback(async () => {
    if (connectedRef.current) return;
    stopRequestedRef.current = false;
    earlyCloseRetryRef.current = 0;
    setMessages([]);
    setCurrentTranscript("");
    await connectInternal();
  }, [connectInternal]);

  const disconnect = useCallback(() => {
    stopRequestedRef.current = true;
    connectedRef.current = false;
    stopMicCapture();
    cancelAudioPlayback();
    hardCloseWebSocket("disconnect");
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    for (const ref of [captureCtxRef, playbackCtxRef]) {
      if (ref.current) { try { ref.current.close(); } catch { } ref.current = null; }
    }
    setStatus("idle");
    setError(null);
    setIsUserSpeaking(false);
    setIsAssistantSpeaking(false);
    setCurrentTranscript("");
    setTimeout(() => { stopRequestedRef.current = false; earlyCloseRetryRef.current = 0; }, 0);
  }, [setStatus, stopMicCapture, cancelAudioPlayback, hardCloseWebSocket]);

  const sendTextMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !text.trim()) return;
    pushMessage(mkMsg("user", text));
    wsRef.current.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    }));
    wsRef.current.send(JSON.stringify({ type: "response.create" }));
    setStatus("processing");
  }, [setStatus, pushMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch { }
      streamRef.current?.getTracks().forEach(t => t.stop());
      for (const ref of [captureCtxRef, playbackCtxRef]) {
        if (ref.current) { try { ref.current.close(); } catch { } }
      }
    };
  }, []);

  const isConnected = ["listening", "speaking", "processing", "reconnecting"].includes(status);

  return {
    status, error, messages, currentTranscript,
    isUserSpeaking, isAssistantSpeaking, isConnected,
    connect, disconnect, sendTextMessage,
  };
}
