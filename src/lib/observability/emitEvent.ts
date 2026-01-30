import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type EventCategory = "system" | "ui" | "flow" | "error" | "signal";
export type EventSeverity = "debug" | "info" | "warning" | "error" | "critical";

const MAX_PAYLOAD_BYTES = 8_000;
const MAX_STACK_CHARS = 800;

const PII_KEYS = [
  "ssn", "tax_id", "ein", "dob", "date_of_birth", "address", "phone", "email",
  "account_number", "routing_number", "passport", "driver_license",
];

function stableStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
  } catch {
    return "";
  }
}

function redactPII(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const key = k.toLowerCase();
    if (PII_KEYS.includes(key)) out[k] = "[REDACTED]";
    else out[k] = v;
  }
  return out;
}

function clampJson(input: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactPII(input);
  const s = JSON.stringify(redacted);
  if (s.length <= MAX_PAYLOAD_BYTES) return redacted;
  return { truncated: true, bytes: s.length, note: "payload exceeded max; redacted summary only" };
}

function getEnv(): string {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return process.env.NODE_ENV ?? "development";
}

function getRelease(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
}

export interface BuddyEvent {
  event_type: string;
  event_category?: EventCategory;
  severity?: EventSeverity;

  deal_id?: string;
  bank_id?: string;
  actor_user_id?: string;
  actor_role?: string;

  payload?: Record<string, unknown>;

  trace_id?: string;
  session_id?: string;
  page_url?: string;

  expected_outcome?: Record<string, unknown>;
  actual_outcome?: Record<string, unknown>;
}

export async function emitBuddyEvent(e: BuddyEvent): Promise<void> {
  const env = getEnv();

  if (
    (e.severity ?? "info") === "debug" &&
    env === "production" &&
    process.env.BUDDY_DEBUG_EVENTS !== "true"
  ) {
    return;
  }

  const expected = e.expected_outcome ? clampJson(e.expected_outcome) : null;
  const actual = e.actual_outcome ? clampJson(e.actual_outcome) : null;

  const is_mismatch =
    Boolean(expected && actual) &&
    stableStringify(expected) !== stableStringify(actual);

  const row = {
    source: "buddy",
    event_type: e.event_type,
    event_category: e.event_category ?? "system",
    severity: e.severity ?? "info",

    deal_id: e.deal_id ?? null,
    bank_id: e.bank_id ?? null,
    actor_user_id: e.actor_user_id ?? null,
    actor_role: e.actor_role ?? null,

    payload: clampJson(e.payload ?? {}),
    trace_id: e.trace_id ?? null,
    session_id: e.session_id ?? null,
    page_url: e.page_url ?? null,

    expected_outcome: expected,
    actual_outcome: actual,
    is_mismatch,

    env,
    release: getRelease(),
  };

  try {
    const { error } = await supabaseAdmin().from("buddy_ledger_events").insert(row);
    if (error) console.error("[emitBuddyEvent] insert failed:", error.message);
  } catch (err) {
    console.error("[emitBuddyEvent] exception:", err);
  }
}

export async function emitErrorEvent(
  event_type: string,
  err: unknown,
  ctx?: {
    deal_id?: string;
    trace_id?: string;
    payload?: Record<string, unknown>;
    actor_user_id?: string;
    actor_role?: string;
  },
): Promise<void> {
  const e =
    err instanceof Error
      ? err
      : new Error(typeof err === "string" ? err : "unknown_error");
  await emitBuddyEvent({
    event_type,
    event_category: "error",
    severity: "error",
    deal_id: ctx?.deal_id,
    trace_id: ctx?.trace_id,
    actor_user_id: ctx?.actor_user_id,
    actor_role: ctx?.actor_role,
    payload: {
      error_name: e.name,
      error_message: e.message,
      stack_trace: e.stack?.slice(0, MAX_STACK_CHARS),
      ...ctx?.payload,
    },
  });
}
