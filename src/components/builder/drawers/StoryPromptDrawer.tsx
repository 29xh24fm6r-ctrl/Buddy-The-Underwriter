"use client";

import { useState, useEffect } from "react";
import { DrawerShell } from "./DrawerShell";

type Props = {
  open: boolean;
  onClose: () => void;
  fieldKey: string;
  prompt: string;
  currentValue: string;
  buddyDraft: string | null;
  confirmation: "confirmed" | "edited" | null;
  onSave: (value: string, confirmation: "confirmed" | "edited") => void;
};

export function StoryPromptDrawer({
  open,
  onClose,
  fieldKey,
  prompt,
  currentValue,
  buddyDraft,
  confirmation,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(currentValue);

  useEffect(() => {
    setDraft(currentValue);
  }, [currentValue, open]);

  const charCount = draft.trim().length;
  const meetsMin = charCount >= 50;

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title="Story"
      onSave={() => {
        onSave(draft, "edited");
        onClose();
      }}
    >
      <div className="text-base text-white/80 font-medium">{prompt}</div>

      {buddyDraft && !draft.trim() && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-amber-400">&#10024;</span>
            <span className="text-xs font-semibold text-amber-300">
              Buddy found this — review and confirm, or edit below
            </span>
          </div>
          <p className="text-sm text-amber-200/80 leading-relaxed">
            {buddyDraft.slice(0, 500)}
            {buddyDraft.length > 500 ? "\u2026" : ""}
          </p>
          <button
            type="button"
            onClick={() => setDraft(buddyDraft)}
            className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-400/20"
          >
            Use Buddy&apos;s Draft
          </button>
        </div>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Type your answer..."
        rows={8}
        className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <div className="flex items-center justify-between">
        <span className={`text-xs ${meetsMin ? "text-emerald-400" : "text-white/40"}`}>
          {charCount} chars {!meetsMin && "(min 50)"}
        </span>
        {draft.trim() && (
          <button
            type="button"
            onClick={() => {
              onSave(draft, "confirmed");
              onClose();
            }}
            className="rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30"
          >
            Confirm
          </button>
        )}
      </div>
    </DrawerShell>
  );
}
