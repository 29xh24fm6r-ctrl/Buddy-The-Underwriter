import type { BuddyContextPack } from "@/buddy/brain/types";
import type { VoiceTurnPlan } from "@/buddy/voice/turnState";
import { FALLBACK_ACKNOWLEDGEMENTS, FALLBACK_ORIENTATIONS, pick } from "@/buddy/voice/fallbackPhrases";
import { EMOTION_PROFILES } from "@/buddy/voice/emotionProfiles";
import { hasSaidSimilar } from "@/buddy/voice/voiceMemory";

export function planVoiceTurn(ctx: BuddyContextPack): VoiceTurnPlan {
  const emotion = EMOTION_PROFILES[ctx.role];

  const ack = pick(FALLBACK_ACKNOWLEDGEMENTS);
  const orient = pick(FALLBACK_ORIENTATIONS);
  const open = hasSaidSimilar(`${ack} ${orient}`) ? ack : `${ack} ${orient}`;

  if (ctx.checklist && typeof ctx.checklist.missing === "number") {
    const missing = ctx.checklist.missing;
    const received = typeof ctx.checklist.received === "number" ? ctx.checklist.received : null;

    if (missing > 0) {
      const base =
        ctx.role === "borrower"
          ? `we’re still missing ${missing} document${missing === 1 ? "" : "s"}.`
          : `checklist update: ${received ?? "?"} received and ${missing} missing.`;

      return {
        immediateUtterance: `${open} ${base}`,
        followUpUtterance:
          ctx.role === "borrower"
            ? "You can upload the remaining items whenever you’re ready."
            : "Next best action is requesting the missing docs.",
      };
    }

    return {
      immediateUtterance:
        emotion.confidence > 0.8
          ? `${ack} Checklist complete. Ready to move forward.`
          : `${ack} Your checklist looks complete.`,
      followUpUtterance:
        ctx.role === "banker"
          ? "You’re clear to move into underwriting."
          : ctx.role === "borrower"
            ? "Your banker can take it from here."
            : undefined,
    };
  }

  return { immediateUtterance: open };
}
