import type { BuddyContextPack } from "@/buddy/brain/types";

export const NUDGE_COOLDOWN_HOURS = 24;

export function shouldSuggestNudge(ctx: BuddyContextPack, lastNudgeAtIso?: string | null) {
  if (ctx.role !== "banker" && ctx.role !== "builder") return false;
  const missing = Number((ctx.checklist as any)?.missing ?? NaN);
  if (!Number.isFinite(missing) || missing <= 0) return false;

  if (!lastNudgeAtIso) return true;
  const last = Date.parse(lastNudgeAtIso);
  if (!Number.isFinite(last)) return true;
  const ageHours = (Date.now() - last) / (1000 * 60 * 60);
  return ageHours >= NUDGE_COOLDOWN_HOURS;
}
