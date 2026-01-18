// src/buddy/getDealIdFromPath.ts
export function getDealIdFromPath(path: string): string | null {
  const m =
    path.match(/\/deals\/([0-9a-fA-F-]{36})(\/|$)/) ||
    path.match(/\/underwrite\/([0-9a-fA-F-]{36})(\/|$)/);
  return m?.[1] ?? null;
}
