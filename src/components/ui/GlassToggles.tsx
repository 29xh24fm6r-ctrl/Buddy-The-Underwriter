"use client";

import { useEffect, useState } from "react";

const GLASS_KEY = "buddy.glass";
const COLOR_KEY = "buddy.color";

function readBool(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
}

function writeBool(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value ? "1" : "0");
}

export default function GlassToggles() {
  const [glass, setGlass] = useState(true);
  const [color, setColor] = useState(true);

  useEffect(() => {
    const nextGlass = readBool(GLASS_KEY, true);
    const nextColor = readBool(COLOR_KEY, true);
    setGlass(nextGlass);
    setColor(nextColor);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (glass) root.classList.add("buddy-glass-on");
    else root.classList.remove("buddy-glass-on");
    if (color) root.classList.add("buddy-color-on");
    else root.classList.remove("buddy-color-on");
    writeBool(GLASS_KEY, glass);
    writeBool(COLOR_KEY, color);
  }, [glass, color]);

  return (
    <div className="flex items-center gap-2 text-xs text-white/70">
      <button
        className={`rounded-full border px-3 py-1 ${glass ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-200" : "border-white/10"}`}
        onClick={() => setGlass((v) => !v)}
      >
        ✨ Glass
      </button>
      <button
        className={`rounded-full border px-3 py-1 ${color ? "border-indigo-400/50 bg-indigo-500/10 text-indigo-200" : "border-white/10"}`}
        onClick={() => setColor((v) => !v)}
      >
        🌈 Color
      </button>
    </div>
  );
}
