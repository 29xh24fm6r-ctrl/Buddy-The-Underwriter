"use client";

import * as React from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

/**
 * Progressive enhancement voice capture using browser SpeechRecognition.
 * If unavailable, user just types.
 */
export function VoiceCaptureBar(props: Props) {
  const [listening, setListening] = React.useState(false);
  const recRef = React.useRef<any>(null);

  function supported() {
    if (typeof window === "undefined") return false;
    const w = window as any;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  function start() {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;

    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      props.onChange(transcript.trim());
    };

    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);

    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function stop() {
    try {
      recRef.current?.stop?.();
    } catch {}
    setListening(false);
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <input
        className="h-11 w-full flex-1 rounded-md border px-3 text-sm"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? "Example: Matt 55, John 25, Sarah 20"}
      />

      {supported() ? (
        <button
          className="h-11 rounded-md border px-4 text-sm font-medium hover:bg-gray-50"
          onClick={listening ? stop : start}
          title="Voice input"
          type="button"
        >
          {listening ? "Stop 🎙️" : "Speak 🎙️"}
        </button>
      ) : null}
    </div>
  );
}
