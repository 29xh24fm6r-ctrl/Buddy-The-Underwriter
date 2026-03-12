/**
 * Fire-and-forget fan-out: trigger N parallel extraction Lambda invocations
 * immediately after intake queues doc.extract outbox events.
 *
 * Each invocation hits /api/workers/doc-extraction?max=1, which claims
 * exactly one outbox row via FOR UPDATE SKIP LOCKED — no double-processing.
 *
 * The cron (every 1 min) remains as a safety net for any docs that
 * slip through (Lambda cold start failures, transient network errors).
 *
 * Concurrency is capped at MAX_CONCURRENT_EXTRACTIONS to stay within
 * Gemini Flash rate limits (1500 RPM on paid tier).
 */

import "server-only";
import { MAX_CONCURRENT_EXTRACTIONS } from "@/lib/intake/constants";

/**
 * @param docCount   Number of extractable docs queued (determines fan-out width)
 * @param baseUrl    App base URL (e.g. https://app.example.com) — from headers or env
 * @param secret     CRON_SECRET or WORKER_SECRET value for auth
 */
export async function fanOutDocExtraction(
  docCount: number,
  baseUrl: string,
  secret: string,
): Promise<void> {
  if (docCount <= 0) return;

  const concurrency = Math.min(docCount, MAX_CONCURRENT_EXTRACTIONS);
  const workerUrl = `${baseUrl}/api/workers/doc-extraction?max=1`;

  console.log("[fanOutDocExtraction] firing parallel extraction workers", {
    docCount,
    concurrency,
    workerUrl,
  });

  // Fire all invocations simultaneously. Each is fire-and-forget —
  // we do NOT await the extraction results here.
  const invocations = Array.from({ length: concurrency }, (_, i) =>
    fetch(workerUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        "x-fan-out-index": String(i),
      },
    })
      .then((res) => {
        if (!res.ok) {
          console.warn("[fanOutDocExtraction] worker invocation non-2xx", {
            index: i,
            status: res.status,
          });
        }
      })
      .catch((err) => {
        // Non-fatal — cron is the safety net
        console.warn("[fanOutDocExtraction] worker invocation failed (non-fatal)", {
          index: i,
          error: err?.message,
        });
      }),
  );

  // Await all fetch() initiations (not their completions — extraction runs
  // inside the invoked Lambda, not here). Promise.allSettled so one failed
  // fetch() init doesn't abort the others.
  await Promise.allSettled(invocations);
}
