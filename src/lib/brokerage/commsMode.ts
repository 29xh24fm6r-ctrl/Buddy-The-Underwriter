/**
 * SPEC-SYSTEM-DEBLOAT-1 Phase A2 — Comms mode startup assertion.
 *
 * BROKERAGE_COMMS_MODE controls whether brokerage comms actually send
 * (Resend/Telnyx) or stub out (see commsAdapters.ts). An unset value must
 * resolve to "stub" (safe default — never silently send); any *set but
 * unrecognized* value is a misconfiguration and must fail loud rather than
 * silently falling back to a mode nobody chose.
 */

import type { CommsMode } from "@/lib/brokerage/commsAdapters";

const VALID_MODES: readonly CommsMode[] = ["stub", "dry_run", "live"];

type SB = { from: (t: string) => any };

/** Resolves BROKERAGE_COMMS_MODE. Unset/empty -> "stub". Unknown value -> throws. */
export function resolveCommsMode(): CommsMode {
  const raw = process.env.BROKERAGE_COMMS_MODE;
  if (raw === undefined || raw === "") return "stub";
  if ((VALID_MODES as readonly string[]).includes(raw)) return raw as CommsMode;
  throw new Error(
    `Invalid BROKERAGE_COMMS_MODE: "${raw}". Must be one of: ${VALID_MODES.join(", ")} (or unset for "stub").`,
  );
}

let loggedThisBoot = false;

/** Logs the resolved comms mode to brokerage_comms_ledger once per process boot. */
export async function logCommsModeResolvedOnce(sb: SB): Promise<CommsMode> {
  const mode = resolveCommsMode();
  if (loggedThisBoot) return mode;
  loggedThisBoot = true;
  await sb.from("brokerage_comms_ledger").insert({
    event_type: "comms_mode_resolved",
    channel: "system",
    recipient_masked: "system",
    metadata: { mode },
    created_at: new Date().toISOString(),
  });
  return mode;
}

/** Test-only: resets the once-per-boot guard so tests can observe fresh boots. */
export function __resetCommsModeBootLogForTests(): void {
  loggedThisBoot = false;
}
