"use client";

import { useState } from "react";
import type { BuilderState, BuilderPrefill, StorySectionData } from "@/lib/builder/builderTypes";
import { StoryPromptDrawer } from "../drawers/StoryPromptDrawer";
import { BuddySourceBadge } from "../BuddySourceBadge";

type Props = {
  state: BuilderState;
  prefill: BuilderPrefill | null;
  onSectionChange: (sectionKey: string, data: Record<string, unknown>) => void;
};

const PROMPTS: { key: keyof StorySectionData; memoKey: string; prompt: string }[] = [
  { key: "loan_purpose_narrative", memoKey: "use_of_proceeds", prompt: "Why does this business need this loan right now?" },
  { key: "management_qualifications", memoKey: "principal_background", prompt: "What makes this management team qualified?" },
  { key: "competitive_position", memoKey: "competitive_position", prompt: "What is this business\u2019s competitive advantage?" },
  { key: "known_weaknesses", memoKey: "key_weaknesses", prompt: "What are the known weaknesses and how are they mitigated?" },
  { key: "deal_strengths", memoKey: "key_strengths", prompt: "What makes this a strong credit?" },
  { key: "committee_notes", memoKey: "committee_notes", prompt: "Anything else the credit committee should know?" },
];

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function StoryWorkspace({ state, prefill, onSectionChange }: Props) {
  const story = (state.sections.story ?? {}) as Partial<StorySectionData>;
  const confirmations = story.story_confirmations ?? {};
  const [drawer, setDrawer] = useState<{ open: boolean; idx: number }>({ open: false, idx: 0 });

  function handleSave(fieldKey: string, value: string, confirmation: "confirmed" | "edited") {
    const next = {
      ...story,
      [fieldKey]: value,
      story_confirmations: { ...confirmations, [fieldKey]: confirmation },
    };
    onSectionChange("story", next);
  }

  function getStatusBadge(fieldKey: string, value: string | undefined): string {
    if (!value || !value.trim()) return "Untouched";
    const conf = confirmations[fieldKey];
    if (conf === "confirmed") return "Confirmed";
    if (conf === "edited") return "Edited";
    return "Reviewed";
  }

  const activePrompt = PROMPTS[drawer.idx];

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-white">Story</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROMPTS.map((p, idx) => {
          const val = story[p.key] as string | undefined;
          const buddyDraft = prefill?.story?.[p.key] as string | undefined;
          const status = getStatusBadge(p.key as string, val);
          const charCount = val?.trim().length ?? 0;
          const statusCls =
            status === "Confirmed" ? "text-emerald-400 border-emerald-500/30 bg-emerald-600/20" :
            status === "Edited" ? "text-blue-400 border-blue-500/30 bg-blue-600/20" :
            status === "Reviewed" ? "text-amber-300 border-amber-500/30 bg-amber-600/20" :
            "text-white/40 border-white/10 bg-white/5";

          return (
            <div key={p.key} className={`${glass} space-y-2`}>
              <div className="text-sm font-medium text-white/90">{p.prompt}</div>
              {buddyDraft && !val?.trim() && (
                <BuddySourceBadge source="buddy" />
              )}
              <div className="text-xs text-white/60 line-clamp-3">
                {val?.trim() ? val.slice(0, 120) + (val.length > 120 ? "\u2026" : "") : "No response yet"}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusCls}`}>
                    {status}
                  </span>
                  <span className={`text-[10px] ${charCount >= 50 ? "text-white/40" : "text-amber-400"}`}>
                    {charCount} chars
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawer({ open: true, idx })}
                  className="text-xs text-primary hover:underline"
                >
                  Edit
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {activePrompt && (
        <StoryPromptDrawer
          open={drawer.open}
          onClose={() => setDrawer({ open: false, idx: drawer.idx })}
          fieldKey={activePrompt.key as string}
          prompt={activePrompt.prompt}
          currentValue={(story[activePrompt.key] as string) ?? ""}
          buddyDraft={(prefill?.story?.[activePrompt.key] as string) ?? null}
          confirmation={confirmations[activePrompt.key as string] ?? null}
          onSave={(value, conf) => handleSave(activePrompt.key as string, value, conf)}
        />
      )}
    </div>
  );
}
