// Buddy Voice Latency Contract

export const VOICE_TTFA_MS = 300;
export const VOICE_HARD_MAX_MS = 600;
export const SHADOW_BRAIN_TIMEOUT_MS = 200;

export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(null);
      });
  });
}
