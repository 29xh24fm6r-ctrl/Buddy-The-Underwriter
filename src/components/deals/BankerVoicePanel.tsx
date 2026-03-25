"use client";

import { useState, useCallback } from "react";
import { useBuddyVoice } from "@/lib/voice/useBuddyVoice";

const STATUS_DISPLAY: Record<string, { icon: string; label: string; color: string }> = {
  idle:          { icon: "\uD83C\uDFA4", label: "Start Financial Review", color: "text-gray-600" },
  connecting:    { icon: "\u23F3", label: "Connecting...",          color: "text-amber-600" },
  listening:     { icon: "\uD83D\uDC42", label: "Listening",              color: "text-emerald-600" },
  speaking:      { icon: "\uD83D\uDD0A", label: "Buddy is speaking",      color: "text-sky-600" },
  processing:    { icon: "\u26A1", label: "Recording fact...",      color: "text-purple-600" },
  error:         { icon: "\u26A0\uFE0F", label: "Error",                  color: "text-rose-600" },
  reconnecting:  { icon: "\uD83D\uDD04", label: "Reconnecting...",        color: "text-amber-600" },
};

export default function BankerVoicePanel({
  dealId,
  onGapResolved,
}: {
  dealId: string;
  onGapResolved?: (factKey: string) => void;
}) {
  const [resolvedKeys, setResolvedKeys] = useState<string[]>([]);

  const handleGapResolved = useCallback((factKey: string) => {
    setResolvedKeys(prev => prev.includes(factKey) ? prev : [...prev, factKey]);
    onGapResolved?.(factKey);
  }, [onGapResolved]);

  const { status, error, messages, currentTranscript,
          isUserSpeaking, isConnected, connect, disconnect } = useBuddyVoice({
    dealId,
    onGapResolved: handleGapResolved,
  });

  const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.idle;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Financial Review
          </span>
          <span className={`text-xs font-medium ${display.color}`}>
            {display.icon} {display.label}
          </span>
          {isUserSpeaking && (
            <span className="text-xs text-emerald-600 animate-pulse">● speaking</span>
          )}
        </div>
        <button
          onClick={isConnected ? disconnect : connect}
          className={`text-xs font-semibold px-3 py-1.5 rounded-md ${
            isConnected
              ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
              : "bg-gray-900 text-white hover:bg-gray-700"
          }`}
        >
          {isConnected ? "End Session" : "Start Review"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* Facts confirmed this session */}
      {resolvedKeys.length > 0 && (
        <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100">
          <div className="text-xs font-semibold text-emerald-700 mb-1">
            Confirmed this session ({resolvedKeys.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {resolvedKeys.map(k => (
              <span key={k} className="text-[10px] font-mono bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Current transcript */}
      {currentTranscript && (
        <div className="px-4 py-2 bg-sky-50 border-b border-sky-100 text-xs text-sky-800 italic">
          {currentTranscript}
        </div>
      )}

      {/* Message history */}
      <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
        {messages.length === 0 && !isConnected && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Start an interview to resolve open deal gaps with Buddy
          </div>
        )}
        {[...messages].reverse().map(msg => (
          <div key={msg.id} className={`px-4 py-2 ${msg.role === "assistant" ? "bg-gray-50" : ""}`}>
            <div className="text-[10px] text-gray-400 mb-0.5">
              {msg.role === "assistant" ? "Buddy" : "Banker"} · {msg.timestamp.toLocaleTimeString()}
            </div>
            <div className="text-xs text-gray-800">{msg.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
