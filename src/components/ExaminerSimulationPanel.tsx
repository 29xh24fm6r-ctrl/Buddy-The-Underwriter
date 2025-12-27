export function ExaminerSimulationPanel({ result }: { result: any }) {
  return (
    <div className="border p-4 rounded">
      <h3>Examiner Risk: {result.risk_level}</h3>
      <ul>
        {result.flags.map((f: string) => (
          <li key={f}>⚠️ {f}</li>
        ))}
      </ul>
    </div>
  );
}
