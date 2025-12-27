/**
 * Minimal redline that is demo-safe:
 * - Compares sections by key
 * - Highlights added/removed/changed with simple markers
 *
 * Upgrade later to a real diff algorithm (word-level).
 */
export type MemoSectionLite = { sectionKey: string; title: string; content: string };

export type MemoDiff = Array<{
  sectionKey: string;
  title: string;
  status: "added" | "removed" | "changed" | "unchanged";
  from?: string;
  to?: string;
}>;

export function diffMemo(a: MemoSectionLite[], b: MemoSectionLite[]): MemoDiff {
  const ma = new Map(a.map((s) => [s.sectionKey, s]));
  const mb = new Map(b.map((s) => [s.sectionKey, s]));

  const keys = Array.from(new Set([...ma.keys(), ...mb.keys()]));

  return keys.map((k) => {
    const A = ma.get(k);
    const B = mb.get(k);
    const title = B?.title ?? A?.title ?? k;

    if (!A && B) return { sectionKey: k, title, status: "added" as const, to: B.content };
    if (A && !B) return { sectionKey: k, title, status: "removed" as const, from: A.content };

    const same = (A!.content ?? "") === (B!.content ?? "");
    if (same) return { sectionKey: k, title, status: "unchanged" as const, from: A!.content, to: B!.content };
    return { sectionKey: k, title, status: "changed" as const, from: A!.content, to: B!.content };
  });
}
