export interface VoiceMemoryEntry {
  ts: number;
  text: string;
}

const MAX_MEMORY = 10;

const memory: VoiceMemoryEntry[] = [];

export function rememberUtterance(text: string) {
  const t = (text ?? "").trim();
  if (!t) return;
  memory.push({ ts: Date.now(), text: t });
  if (memory.length > MAX_MEMORY) memory.shift();
}

export function getRecentUtterances(): string[] {
  return memory.map((m) => m.text);
}

export function hasSaidSimilar(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const key = t.slice(0, 18);
  return memory.some((m) => m.text.includes(key));
}
