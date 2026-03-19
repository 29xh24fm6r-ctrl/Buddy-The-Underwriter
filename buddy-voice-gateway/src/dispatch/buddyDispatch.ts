/**
 * buddyDispatch.ts — Routes tool intents from Gemini to Buddy Next.js API.
 *
 * The gateway calls POST /api/deals/[dealId]/banker-session/dispatch on the
 * Buddy Vercel deployment. This route receives the banker's confirmed fact
 * and writes it to deal_financial_facts via resolveDealGap().
 */

import { env } from "../lib/env.js";

const BUDDY_APP_URL = env("BUDDY_APP_URL");
const GATEWAY_SECRET = env("BUDDY_GATEWAY_SECRET");

interface DispatchArgs {
  intent: string;
  userId: string;
  dealId: string;
  bankId: string;
  sessionId: string;
  gapId?: string;
  factKey?: string;
  value?: string;
}

interface DispatchResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function routeBuddyIntent(args: DispatchArgs): Promise<DispatchResult> {
  const { dealId, ...rest } = args;

  try {
    const res = await fetch(
      `${BUDDY_APP_URL}/api/deals/${dealId}/banker-session/dispatch`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gateway-secret": GATEWAY_SECRET,
        },
        body: JSON.stringify(rest),
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) {
      return { success: false, error: `dispatch_http_${res.status}` };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
