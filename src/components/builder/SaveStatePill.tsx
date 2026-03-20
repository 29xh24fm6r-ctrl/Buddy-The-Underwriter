"use client";

import { useEffect, useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveStatePill({ state }: { state: SaveState }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (state === "saved") {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 1200);
      return () => clearTimeout(t);
    }
    if (state === "saving" || state === "error") {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [state]);

  if (!visible) return null;

  const label =
    state === "saving" ? "Saving\u2026" : state === "saved" ? "Saved \u2713" : state === "error" ? "Save failed" : null;

  const cls =
    state === "error"
      ? "text-rose-300 border-rose-500/30 bg-rose-600/20"
      : state === "saved"
        ? "text-emerald-300 border-emerald-500/30 bg-emerald-600/20"
        : "text-white/60 border-white/10 bg-white/5";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-opacity ${cls}`}
    >
      {label}
    </span>
  );
}
