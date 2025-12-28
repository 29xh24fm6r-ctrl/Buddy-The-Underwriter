import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ConsentEvent = {
  kind: string;
  created_at: string;
};

/**
 * Check SMS consent state for a phone number
 * Looks at deal_events for the latest opt-out/opt-in event
 * 
 * Logic:
 * - No events = allowed (default opt-in)
 * - Last event = sms_opt_out = blocked
 * - Last event = sms_opt_in = allowed
 */
export async function getSmsConsentState(phoneE164: string): Promise<"allowed" | "blocked"> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_events")
    .select("kind, created_at")
    .in("kind", ["sms_opt_out", "sms_opt_in"])
    .or(`metadata->>phone.eq.${phoneE164},metadata->>from.eq.${phoneE164}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("getSmsConsentState error:", error);
    throw new Error(`getSmsConsentState failed: ${error.message}`);
  }

  const last = data?.[0] as ConsentEvent | undefined;
  
  // Default: no consent events = allowed (implicit opt-in via business relationship)
  if (!last) return "allowed";
  
  // Last event determines current state
  return last.kind === "sms_opt_out" ? "blocked" : "allowed";
}

/**
 * Assert that SMS is allowed for this phone number
 * Throws if opted out
 */
export async function assertSmsAllowed(phoneE164: string) {
  const state = await getSmsConsentState(phoneE164);
  if (state === "blocked") {
    const err = new Error(`SMS blocked (opted out): ${phoneE164}`);
    (err as any).code = "SMS_OPTED_OUT";
    throw err;
  }
}
