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

// INCIDENT (2026-07-22): this only ever searched for a bare "\n\n" frame
// boundary and split lines on bare "\n". Every hand-written test fixture in
// this repo's test suite uses LF-only framing, so that blind spot was
// invisible in tests — but Gemini's real streamGenerateContent SSE response
// uses CRLF line endings. Diagnostic logging (src/lib/ai/geminiClient.ts)
// caught this live: production requests were returning HTTP 200 with ~19KB
// of real SSE data across dozens of chunks, yet this function extracted
// zero events from it every single time, because "\r\n\r\n" does not
// contain the substring "\n\n". This was the actual root cause of the
// "model produced no reply text" concierge-chat incident — the request and
// Gemini's response were fine the entire time; #727-#729 were each fixing a
// real-but-secondary config issue while this parsing bug was the one thing
// that mattered. Now tolerant of CRLF, bare CR, and bare LF framing.
const FRAME_BOUNDARY_RE = /\r\n\r\n|\n\n|\r\r/;
const LINE_SPLIT_RE = /\r\n|\r|\n/;

export function splitSSEEvents(buffer: string): {
  events: SSEEvent[];
  rest: string;
} {
  const events: SSEEvent[] = [];
  let rest = buffer;

  let match: RegExpMatchArray | null;
  while ((match = rest.match(FRAME_BOUNDARY_RE)) !== null) {
    const boundary = match.index as number;
    const rawFrame = rest.slice(0, boundary);
    rest = rest.slice(boundary + match[0].length);

    let event = "message";
    const dataLines: string[] = [];
    for (const line of rawFrame.split(LINE_SPLIT_RE)) {
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
