import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERCEL_JSON = resolve(process.cwd(), "vercel.json");

test("[cron-1] doc-extraction cron runs every 2 minutes", () => {
  const config = JSON.parse(readFileSync(VERCEL_JSON, "utf8"));
  const crons = config.crons ?? [];
  const docExtract = crons.find((c: any) =>
    typeof c?.path === "string" && c.path.startsWith("/api/workers/doc-extraction"),
  );
  assert.ok(docExtract, "doc-extraction cron must exist");
  assert.equal(
    docExtract.schedule,
    "*/2 * * * *",
    "doc-extraction cron must run every 2 minutes (was */5)",
  );
});

test("[cron-2] doc-extraction batch size param is 8", () => {
  const config = JSON.parse(readFileSync(VERCEL_JSON, "utf8"));
  const crons = config.crons ?? [];
  const docExtract = crons.find((c: any) =>
    typeof c?.path === "string" && c.path.startsWith("/api/workers/doc-extraction"),
  );
  assert.ok(docExtract);
  assert.match(
    docExtract.path,
    /\bmax=8\b/,
    "doc-extraction cron must pass max=8 (under hard cap of 10)",
  );
});

test("[cron-3] other cron schedules are unchanged", () => {
  const config = JSON.parse(readFileSync(VERCEL_JSON, "utf8"));
  const crons = config.crons ?? [];

  // Spot-check the other crons we deliberately did NOT touch
  const intakeOutbox = crons.find((c: any) =>
    typeof c?.path === "string" && c.path.startsWith("/api/workers/intake-outbox"),
  );
  const pulseOutbox = crons.find((c: any) =>
    typeof c?.path === "string" && c.path.startsWith("/api/workers/pulse-outbox"),
  );

  assert.equal(intakeOutbox?.schedule, "*/5 * * * *", "intake-outbox cron unchanged");
  assert.equal(pulseOutbox?.schedule, "*/5 * * * *", "pulse-outbox cron unchanged");
});

test("[cron-4] lock-janitor cron exists and runs every 5 minutes", () => {
  // SPEC-ADVISORY-LOCK-XACT-MIGRATION-1: belt-and-suspenders janitor that
  // terminates idle postgrest connections holding stale worker advisory locks.
  const config = JSON.parse(readFileSync(VERCEL_JSON, "utf8"));
  const crons = config.crons ?? [];
  const janitor = crons.find((c: any) =>
    typeof c?.path === "string" && c.path.startsWith("/api/workers/lock-janitor"),
  );
  assert.ok(janitor, "lock-janitor cron must exist in vercel.json");
  assert.equal(janitor.schedule, "*/5 * * * *");
});
