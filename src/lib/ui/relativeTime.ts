export function relativeTime(ts?: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts).getTime();
  if (Number.isNaN(d)) return null;

  const diffMs = Date.now() - d;
  const s = Math.floor(diffMs / 1000);
  if (s < 10) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Updated ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `Updated ${h}h ago`;
  const days = Math.floor(h / 24);
  return `Updated ${days}d ago`;
}
