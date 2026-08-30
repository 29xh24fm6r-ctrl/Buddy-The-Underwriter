export type ReminderEventRow = {
  created_at: string | null;
  payload: unknown;
};

export type ReminderOutboundRow = {
  created_at: string | null;
  provider_message_id: string | null;
};

function requireTimestamp(value: string | null, source: string): {
  iso: string;
  millis: number;
} {
  if (!value) {
    throw new Error(`Malformed ${source} reminder evidence: missing created_at`);
  }

  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    throw new Error(`Malformed ${source} reminder evidence: invalid created_at`);
  }

  return { iso: value, millis };
}

function requireEventSid(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("Malformed reminder event evidence: missing payload");
  }

  const sid = (payload as Record<string, unknown>).sid;
  if (typeof sid !== "string" || sid.trim() === "") {
    throw new Error("Malformed reminder event evidence: missing provider sid");
  }

  return sid;
}

function requireOutboundSid(value: string | null): string {
  if (!value || value.trim() === "") {
    throw new Error("Malformed outbound reminder evidence: missing provider sid");
  }

  return value;
}

/**
 * Reconcile the two canonical SMS ledgers by Twilio SID.
 *
 * sendSmsWithConsent writes outbound_messages for delivery tracking and
 * deal_events for the deal timeline. A partial persistence failure must not
 * make a dispatched reminder disappear from cooldown/max-attempt accounting.
 */
export function reconcileReminderAttempts(args: {
  events: ReminderEventRow[];
  outbound: ReminderOutboundRow[];
}): { attempts: number; lastAt: string | null } {
  const bySid = new Map<string, { iso: string; millis: number }>();

  for (const event of args.events) {
    const sid = requireEventSid(event.payload);
    const timestamp = requireTimestamp(event.created_at, "deal event");
    const current = bySid.get(sid);
    if (!current || timestamp.millis > current.millis) {
      bySid.set(sid, timestamp);
    }
  }

  for (const row of args.outbound) {
    const sid = requireOutboundSid(row.provider_message_id);
    const timestamp = requireTimestamp(row.created_at, "outbound message");
    const current = bySid.get(sid);
    if (!current || timestamp.millis > current.millis) {
      bySid.set(sid, timestamp);
    }
  }

  let latest: { iso: string; millis: number } | null = null;
  for (const timestamp of bySid.values()) {
    if (!latest || timestamp.millis > latest.millis) {
      latest = timestamp;
    }
  }

  return {
    attempts: bySid.size,
    lastAt: latest?.iso ?? null,
  };
}
