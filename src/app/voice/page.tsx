"use client";

import { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export default function VoicePage() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  async function startCall() {
    setError(null);

    try {
      // Get microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create peer connection
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      // Add microphone track
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle incoming audio
      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioElementRef.current = audioEl;

      pc.addEventListener("track", (e) => {
        audioEl.srcObject = e.streams[0];
      });

      // Create data channel for events/transcripts
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      dc.addEventListener("message", (e) => {
        try {
          const event = JSON.parse(e.data);
          
          // Handle different event types from Realtime API
          if (event.type === "conversation.item.created") {
            const item = event.item;
            if (item.type === "message") {
              const role = item.role as "user" | "assistant";
              const content = item.content?.[0]?.transcript || item.content?.[0]?.text || "";
              
              if (content) {
                setMessages((prev) => [
                  ...prev,
                  {
                    role,
                    content,
                    timestamp: Date.now(),
                  },
                ]);
              }
            }
          }
        } catch (err) {
          console.error("Error parsing event:", err);
        }
      });

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Get ephemeral key from backend
      const tokenRes = await fetch("/api/realtime/session", {
        method: "POST",
      });

      if (!tokenRes.ok) {
        throw new Error("Failed to get session token");
      }

      const tokenData = await tokenRes.json();

      // Send offer to OpenAI Realtime API
      // NOTE: The actual WebRTC signaling with OpenAI Realtime API
      // requires the official OpenAI WebRTC client or direct API calls
      // This is a simplified version - refer to OpenAI docs for production setup
      
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";

      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        throw new Error("Failed to connect to Realtime API");
      }

      const answer = {
        type: "answer" as RTCSdpType,
        sdp: await sdpResponse.text(),
      };

      await pc.setRemoteDescription(answer);

      setIsConnected(true);
      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start call");
      console.error("Error starting call:", err);
    }
  }

  function stopCall() {
    // Stop tracks
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (audioElementRef.current) {
      audioElementRef.current.srcObject = null;
      audioElementRef.current = null;
    }

    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    setIsConnected(false);
    setIsRecording(false);
  }

  useEffect(() => {
    return () => {
      stopCall();
    };
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Voice with Buddy</h1>
          <p className="mt-2 text-slate-400">
            Talk to Buddy using OpenAI Realtime API (WebRTC)
          </p>
        </div>

        {/* Connection Status */}
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`h-3 w-3 rounded-full ${
                  isConnected ? "bg-emerald-500" : "bg-slate-600"
                } ${isConnected ? "animate-pulse" : ""}`}
              />
              <span className="text-sm font-medium text-white">
                {isConnected ? "Connected" : "Disconnected"}
              </span>
              {isRecording && (
                <span className="text-xs text-slate-400">(Recording)</span>
              )}
            </div>

            <button
              onClick={isConnected ? stopCall : startCall}
              className={`rounded-lg px-6 py-2 font-semibold text-white ${
                isConnected
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {isConnected ? "Stop" : "Start Call"}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-800 bg-red-900/20 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="mt-4 rounded-lg bg-slate-800 p-4">
            <p className="text-xs text-slate-400 mb-2">
              Note: This is a Phase 1 prototype. Full WebRTC signaling requires
              OpenAI's official Realtime client or direct API integration.
            </p>
            <p className="text-xs text-slate-400">
              For production, use the @openai/realtime-api-beta package or
              follow the official WebRTC guide.
            </p>
          </div>
        </div>

        {/* Transcript */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Transcript</h2>

          <div className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">
                Start a call to see transcript
              </p>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 ${
                    msg.role === "user"
                      ? "bg-blue-900/20 border border-blue-800"
                      : "bg-slate-800"
                  }`}
                >
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                    {msg.role === "user" ? "You" : "Buddy"}
                  </div>
                  <div className="text-sm text-white">{msg.content}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
