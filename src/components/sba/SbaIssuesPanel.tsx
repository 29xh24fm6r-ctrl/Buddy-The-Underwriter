export function SbaIssuesPanel({ preflight }: { preflight: any }) {
  if (!preflight) return null;

  return (
    <div className="rounded border p-4 space-y-3">
      <div className="text-sm font-semibold">Preflight Issues</div>

      {[...(preflight.blocking_issues ?? []), ...(preflight.warnings ?? [])].map(
        (issue: any, i: number) => (
          <div key={i} className="rounded border p-3">
            <div className="font-semibold text-sm">{issue.message}</div>
            <div className="text-xs text-neutral-600 mt-1">{issue.explanation}</div>

            {issue.sop && (
              <div className="text-xs mt-1">
                📘 {issue.sop.citation}
              </div>
            )}

            {issue.how_to_fix && (
              <div className="text-xs mt-1 text-neutral-700">
                🔧 {issue.how_to_fix}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
