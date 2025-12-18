export function SbaScoreCard({ preflight }: { preflight: any }) {
  if (!preflight) return null;

  const color =
    preflight.score >= 90 ? "bg-green-100"
    : preflight.score >= 75 ? "bg-yellow-100"
    : "bg-red-100";

  return (
    <div className={`rounded border p-4 ${color}`}>
      <div className="text-sm font-semibold">SBA Readiness Score</div>
      <div className="text-3xl font-bold">{preflight.score}</div>
      <div className="text-xs text-neutral-600">
        {preflight.passed ? "Ready for submission" : "Fix blocking issues before submission"}
      </div>
    </div>
  );
}
