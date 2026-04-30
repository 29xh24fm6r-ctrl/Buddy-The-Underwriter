import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { nextBusinessDayAt, computeListingCadence } =
  require("../cadence") as typeof import("../cadence");

function ctHour(date: Date): number {
  // Returns the hour in America/Chicago. Used only in assertions.
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hour12: false,
    }).format(date),
  );
}

function ctWeekday(date: Date): number {
  // 0=Sun, 1=Mon, ..., 6=Sat in America/Chicago.
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
  }).format(date);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(name);
}

test("Tuesday midday CT → Wednesday 9am CT", () => {
  // 2026-05-05 is a Tuesday. 18:00 UTC = 13:00 CT in May (DST).
  const tuesMidday = new Date("2026-05-05T18:00:00Z");
  const next = nextBusinessDayAt(tuesMidday, 9);
  assert.equal(ctWeekday(next), 3, "next business day should be Wednesday");
  assert.equal(ctHour(next), 9);
});

test("Friday afternoon CT → Monday 9am CT (skips weekend)", () => {
  // 2026-05-01 is a Friday. 18:00 UTC = 13:00 CT.
  const friAfternoon = new Date("2026-05-01T18:00:00Z");
  const next = nextBusinessDayAt(friAfternoon, 9);
  assert.equal(ctWeekday(next), 1, "should roll to Monday");
  assert.equal(ctHour(next), 9);
});

test("Saturday → Monday 9am CT", () => {
  const sat = new Date("2026-05-02T18:00:00Z");
  const next = nextBusinessDayAt(sat, 9);
  assert.equal(ctWeekday(next), 1);
  assert.equal(ctHour(next), 9);
});

test("Sunday → Monday 9am CT", () => {
  const sun = new Date("2026-05-03T18:00:00Z");
  const next = nextBusinessDayAt(sun, 9);
  assert.equal(ctWeekday(next), 1);
  assert.equal(ctHour(next), 9);
});

test("computeListingCadence: preview → claim → close shape", () => {
  const tuesMidday = new Date("2026-05-05T18:00:00Z");
  const { previewOpensAt, claimOpensAt, claimClosesAt } =
    computeListingCadence(tuesMidday);

  // Preview is the next 9am CT business day (Wednesday).
  assert.equal(ctWeekday(previewOpensAt), 3);
  assert.equal(ctHour(previewOpensAt), 9);

  // Claim opens exactly 24h after preview.
  const gap1 = claimOpensAt.getTime() - previewOpensAt.getTime();
  assert.equal(gap1, 24 * 60 * 60 * 1000);

  // Claim closes exactly 8h after claim opens (5pm CT same day).
  const gap2 = claimClosesAt.getTime() - claimOpensAt.getTime();
  assert.equal(gap2, 8 * 60 * 60 * 1000);
  assert.equal(ctHour(claimClosesAt), 17);
});

test("cadence from Friday sealing: preview Monday, claim Tuesday, close Tuesday 5pm CT", () => {
  const friEvening = new Date("2026-05-01T22:00:00Z");
  const { previewOpensAt, claimOpensAt, claimClosesAt } =
    computeListingCadence(friEvening);

  assert.equal(ctWeekday(previewOpensAt), 1); // Monday
  assert.equal(ctWeekday(claimOpensAt), 2); // Tuesday
  assert.equal(ctWeekday(claimClosesAt), 2); // Tuesday
  assert.equal(ctHour(claimClosesAt), 17);
});
