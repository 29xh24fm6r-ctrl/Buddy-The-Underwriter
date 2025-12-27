export function BorrowerDelightPanel({ readiness }: { readiness: any }) {
  return (
    <div className="p-4 border rounded-xl">
      <h2 className="font-semibold">Your Loan Readiness</h2>
      <p>Status: {readiness.label}</p>
      <ul>
        {readiness.blockers.map((b: string) => (
          <li key={b}>❗ {b}</li>
        ))}
      </ul>
    </div>
  );
}
