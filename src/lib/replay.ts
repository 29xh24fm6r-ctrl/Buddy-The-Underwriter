export function replayEvents(events: any[], until?: Date) {
  return events
    .filter(e => !until || new Date(e.created_at) <= until)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
