import { splitSSEEvents } from "@/lib/sse/parseSSEBuffer";

/**
 * Final payload shape sent on the stream's "done" event — mirrors the plain
 * JSON response the short-circuit paths (trident intent, assumptions
 * confirm, rate limit) still return directly, so callers can treat both
 * uniformly once resolved.
 */
export type ConciergeDoneData = {
  ok: boolean;
  dealId?: string;
  buddyResponse?: string;
  extractedFacts?: Record<string, unknown>;
  progressPct?: number;
  nextQuestion?: string | null;
  sessionClaimed?: boolean;
  assistantMessage?: string;
  nextRequiredFields?: string[];
  readinessHint?: string;
};

/**
 * Reads the concierge route's SSE body: "token" events stream the reply as
 * it's generated, one final "done" event carries the same metadata the
 * non-streaming response paths return. Malformed/partial frames are
 * skipped rather than thrown — a borrower mid-conversation should never see
 * a hard crash over one dropped chunk.
 */
export async function consumeConciergeStream(
  body: ReadableStream<Uint8Array>,
  handlers: {
    onToken: (text: string) => void;
    onDone: (data: ConciergeDoneData) => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let settled = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const { events, rest } = splitSSEEvents(buf);
      buf = rest;

      for (const evt of events) {
        if (evt.event === "token") {
          try {
            const parsed = JSON.parse(evt.data) as { text?: string };
            if (parsed.text) handlers.onToken(parsed.text);
          } catch {
            // Skip a malformed token frame — the stream keeps going.
          }
        } else if (evt.event === "done") {
          settled = true;
          try {
            handlers.onDone(JSON.parse(evt.data) as ConciergeDoneData);
          } catch {
            handlers.onError("malformed_done_event");
          }
        } else if (evt.event === "error") {
          settled = true;
          try {
            const parsed = JSON.parse(evt.data) as { message?: string };
            handlers.onError(parsed.message ?? "stream_error");
          } catch {
            handlers.onError("stream_error");
          }
        }
      }
    }
  } finally {
    if (!settled) handlers.onError("stream_ended_without_done");
  }
}
