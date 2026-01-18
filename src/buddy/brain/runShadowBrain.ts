import type { BuddyContextPack } from "@/buddy/brain/types";
import { SHADOW_BRAIN_TIMEOUT_MS, withDeadline } from "@/buddy/voice/latency";

export async function runShadowBrain(ctx: BuddyContextPack) {
  const enqueue = fetch("/api/buddy/shadow-brain/enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ctx }),
    keepalive: true,
  })
    .then((r) => r.json())
    .catch(() => null);

  const enq = await withDeadline(enqueue, 120);
  const requestKey = enq?.requestKey;
  if (!requestKey) return null;

  const latest = fetch(`/api/buddy/shadow-brain/latest?requestKey=${encodeURIComponent(requestKey)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
    .then((r) => r.json())
    .catch(() => null);

  const out = await withDeadline(latest, SHADOW_BRAIN_TIMEOUT_MS);
  if (!out?.ok) return null;
  if (out.status !== "ready") return null;
  return out.result_json ?? null;
}
