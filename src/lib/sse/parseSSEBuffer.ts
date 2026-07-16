/**
 * Pure Server-Sent-Events frame splitter. No fetch, no DOM, no server-only —
 * used on both sides of a stream: server-side to parse Gemini's own SSE
 * response, and client-side to parse this app's own SSE responses back to
 * the browser. Kept dependency-free so both can share one tested
 * implementation instead of hand-rolling the same `\n\n`-boundary parsing
 * twice.
 *
 * Callers own the read loop (fetch + ReadableStream reader, or Node's
 * response body) — this function only knows how to carve complete frames
 * out of a growing text buffer and hand back whatever's left unparsed.
 */
export type SSEEvent = { event: string; data: string };

export function splitSSEEvents(buffer: string): {
  events: SSEEvent[];
  rest: string;
} {
  const events: SSEEvent[] = [];
  let rest = buffer;

  let boundary: number;
  while ((boundary = rest.indexOf("\n\n")) !== -1) {
    const rawFrame = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);

    let event = "message";
    const dataLines: string[] = [];
    for (const line of rawFrame.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join("\n") });
    }
  }

  return { events, rest };
}
