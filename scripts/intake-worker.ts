/**
 * Local intake outbox consumer.
 *
 * Polls processIntakeOutbox() directly — same domain function used by
 * the Vercel Cron (/api/workers/intake-outbox). No HTTP layer in between.
 *
 * Usage:
 *   npm run worker:intake
 *
 * Env (loaded via --env-file=.env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — required (read by supabaseAdmin)
 *   INTAKE_POLL_MS                           — poll interval (default 5000)
 */

import { processIntakeOutbox } from "@/lib/workers/processIntakeOutbox";

const POLL_MS = Number(process.env.INTAKE_POLL_MS ?? "5000");
const MAX_ROWS = Number(process.env.INTAKE_BATCH_SIZE ?? "5");
let running = true;

process.on("SIGINT", () => {
  running = false;
  console.log("\n[intake-worker] received SIGINT, finishing current cycle...");
});
process.on("SIGTERM", () => {
  running = false;
  console.log("\n[intake-worker] received SIGTERM, finishing current cycle...");
});

async function main() {
  console.log(
    `[intake-worker] started — polling every ${POLL_MS}ms, batch size ${MAX_ROWS}`,
  );

  while (running) {
    try {
      const r = await processIntakeOutbox(MAX_ROWS);

      if (r.claimed > 0) {
        console.log(
          `[intake-worker] claimed=${r.claimed} processed=${r.processed} failed=${r.failed} dead_lettered=${r.dead_lettered}`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[intake-worker] error: ${msg}`);
    }

    if (running) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  console.log("[intake-worker] shut down cleanly");
  process.exit(0);
}

main();
