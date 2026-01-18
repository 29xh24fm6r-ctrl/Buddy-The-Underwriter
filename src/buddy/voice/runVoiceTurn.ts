import { buildContextPack } from "@/buddy/brain/buildContextPack";
import { runShadowBrain } from "@/buddy/brain/runShadowBrain";
import { planVoiceTurn } from "@/buddy/voice/planVoiceTurn";
import { pickContextualWhisper } from "@/buddy/voice/whispers";
import { rememberUtterance } from "@/buddy/voice/voiceMemory";
import { buddySessionStore } from "@/buddy/memory/buddySessionStore";
import { setVoiceVariant, type Variant } from "@/buddy/voice/phraseVariants";
import { whisperDelayMs } from "@/buddy/voice/emotionProfiles";

export async function runVoiceTurn(speak: (text: string) => void) {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const state = buddySessionStore.getState();
  const ctx = buildContextPack({ state, path });

  const v = (process.env.NEXT_PUBLIC_BUDDY_VOICE_VARIANT ?? "A") as Variant;
  setVoiceVariant(v === "B" ? "B" : "A");

  const plan = planVoiceTurn(ctx);
  speak(plan.immediateUtterance);
  rememberUtterance(plan.immediateUtterance);

  let shadowResolved = false;
  const shadowPromise = runShadowBrain(ctx).then((r) => {
    shadowResolved = true;
    return r;
  });

  const delay = whisperDelayMs(ctx.role);
  const whisperTimer = setTimeout(() => {
    if (!shadowResolved) {
      const st = buddySessionStore.getState();
      const whisper = pickContextualWhisper(ctx.role, (st as any).lastAction ?? null);
      speak(whisper);
      rememberUtterance(whisper);
    }
  }, delay);

  const shadow = await shadowPromise;
  clearTimeout(whisperTimer);

  if (shadow && plan.followUpUtterance) {
    speak(plan.followUpUtterance);
    rememberUtterance(plan.followUpUtterance);
  }
}
