import type { BuddyRole } from "@/buddy/types";

export interface EmotionProfile {
  pace: "slow" | "normal" | "fast";
  warmth: number;
  confidence: number;
}

export const EMOTION_PROFILES: Record<BuddyRole, EmotionProfile> = {
  borrower: { pace: "slow", warmth: 0.9, confidence: 0.65 },
  banker: { pace: "fast", warmth: 0.35, confidence: 0.9 },
  builder: { pace: "normal", warmth: 0.15, confidence: 1.0 },
};

export function whisperDelayMs(role: BuddyRole) {
  if (role === "borrower") return 160;
  if (role === "banker") return 220;
  return 190;
}
