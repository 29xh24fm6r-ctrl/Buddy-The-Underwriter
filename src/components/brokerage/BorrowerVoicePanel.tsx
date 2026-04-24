"use client";

/**
 * BorrowerVoicePanel — Gemini Live voice UI for anonymous brokerage borrowers.
 *
 * Uses useBuddyVoice with the brokerage token endpoint. No Clerk, no deal
 * context beyond dealId — identity flows via the HTTP-only session cookie.
 * No gap-resolution callback (borrower scope has no gap engine). No fact
 * display (facts are extracted server-side from transcripts; this is a
 * listener-only UI for Sprint 2).
 */

import { useBuddyVoice } from "@/lib/voice/useBuddyVoice";

const STATUS_DISPLAY: Record<
  string,
  { icon: string; label: string; color: string }
> = {
  idle: { icon: "🎤", label: "Talk to Buddy", color: "text-gray-600" },
  connecting: { icon: "⏳", label: "Connecting…", color: "text-amber-600" },
  listening: { icon: "👂", label: "I'm listening", color: "text-emerald-600" },
  speaking: { icon: "🔊", label: "Buddy is speaking", color: "text-sky-600" },
  processing: { icon: "⚡", label: "Thinking…", color: "text-purple-600" },
  error: { icon: "⚠️", label: "Connection error", color: "text-rose-600" },
  reconnecting: { icon: "🔄", label: "Reconnecting…", color: "text-amber-600" },
};

export default function BorrowerVoicePanel({ dealId }: { dealId: string }) {
  const {
    status,
    error,
    messages,
    currentTranscript,
    isUserSpeaking,
    connect,
    disconnect,
  } = useBuddyVoice({
    dealId,
    tokenEndpoint: "/api/brokerage/voice/gemini-token",
  });

  const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.idle;
  const isConnected = status !== "idle" && status !== "error";

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">
            Talk to Buddy
          </span>
          <span className={`text-xs font-medium ${display.color}`}>
            {display.icon} {display.label}
          </span>
          {isUserSpeaking && (
            <span className="text-xs text-emerald-600 animate-pulse">
              ● speaking
            </span>
          )}
        </div>
        <button
          onClick={isConnected ? disconnect : connect}
          className={`text-sm font-semibold px-4 py-2 rounded-md ${
            isConnected
              ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
              : "bg-gray-900 text-white hover:bg-gray-700"
          }`}
        >
          {isConnected ? "End call" : "Start call"}
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 text-xs text-rose-700">
          {error}
        </div>
      )}

      {currentTranscript && (
        <div className="px-4 py-2 bg-sky-50 border-b border-sky-100 text-sm text-sky-800 italic">
          {currentTranscript}
        </div>
      )}

      <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
        {messages.length === 0 && !isConnected && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Tap &ldquo;Start call&rdquo; and tell Buddy what you&rsquo;re
            looking for. He&rsquo;ll listen, ask follow-ups, and figure out
            which lenders to match you with.
          </div>
        )}
        {[...messages].reverse().map((msg) => (
          <div
            key={msg.id}
            className={`px-4 py-3 ${
              msg.role === "assistant" ? "bg-gray-50" : ""
            }`}
          >
            <div className="text-[10px] text-gray-400 mb-0.5">
              {msg.role === "assistant" ? "Buddy" : "You"} ·{" "}
              {msg.timestamp.toLocaleTimeString()}
            </div>
            <div className="text-sm text-gray-800">{msg.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
