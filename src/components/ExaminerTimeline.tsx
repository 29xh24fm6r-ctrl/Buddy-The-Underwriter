export function ExaminerTimeline({ events }: { events: any[] }) {
  return (
    <ul>
      {events.map(e => (
        <li key={e.id}>
          {e.created_at} — {e.kind}
        </li>
      ))}
    </ul>
  );
}
