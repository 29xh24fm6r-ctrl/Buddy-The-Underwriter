import "server-only";

/**
 * POST /api/brokerage/session/clear
 *
 * Deletes the `buddy_borrower_session` cookie so the next load of /start
 * treats this device as a brand-new borrower instead of silently resuming
 * whatever deal_id the cookie points at.
 *
 * This does NOT delete the underlying deal — it only forgets the device's
 * pointer to it. A borrower who claimed their session with an email can
 * always get back to that deal by re-verifying with that email.
 *
 * Resolves identity server-side (getBorrowerSessionFromRequest) before
 * clearing, rather than blindly deleting whatever cookie name shows up —
 * matches the pattern every other /api/brokerage/** route follows.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBorrowerSessionFromRequest } from "@/lib/brokerage/session";

const COOKIE_NAME = "buddy_borrower_session";

export async function POST() {
  const session = await getBorrowerSessionFromRequest();
  const cookieStore = await cookies();
  cookieStore.delete({ name: COOKIE_NAME, path: "/" });
  return NextResponse.json({ ok: true, hadSession: session !== null });
}
