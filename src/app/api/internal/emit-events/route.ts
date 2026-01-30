import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { requireValidInvite } from "@/lib/portal/auth";
import { sha256Base64url } from "@/lib/portal/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVENTS = 50;
const MAX_BODY_BYTES = 40_000;

const ALLOWED_UI_TYPES = new Set([
  "button_click",
  "link_click",
  "navigation",
  "route_mismatch",
  "form_submit",
]);

function tooLarge(req: Request): boolean {
  const len = req.headers.get("content-length");
  if (!len) return false;
  const n = Number(len);
  return Number.isFinite(n) && n > MAX_BODY_BYTES;
}

// Lightweight in-memory rate limit (per IP+minute). Replace with Upstash if needed.
const buckets = new Map<string, { t: number; c: number }>();
function rateLimit(key: string, limitPerMin: number): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const cur = buckets.get(key);
  if (!cur || now - cur.t > windowMs) {
    buckets.set(key, { t: now, c: 1 });
    return true;
  }
  if (cur.c >= limitPerMin) return false;
  cur.c += 1;
  return true;
}

export async function POST(req: Request) {
  try {
    if (tooLarge(req))
      return NextResponse.json({ ok: false, error: "body_too_large" }, { status: 413 });

    // Origin guard (best-effort)
    const origin = req.headers.get("origin") ?? "";
    const host = req.headers.get("host") ?? "";
    if (origin && !origin.includes(host)) {
      return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!rateLimit(`${ip}:${new Date().toISOString().slice(0, 16)}`, 120)) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }

    const { userId } = await clerkAuth();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object")
      return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });

    const events = Array.isArray((body as Record<string, unknown>).events)
      ? ((body as Record<string, unknown>).events as unknown[])
      : [];
    const portal_token =
      typeof (body as Record<string, unknown>).portal_token === "string"
        ? ((body as Record<string, unknown>).portal_token as string)
        : undefined;

    if (!events.length) return NextResponse.json({ ok: true, inserted: 0 });

    const batch = events.slice(0, MAX_EVENTS);

    // Actor resolution
    let actor_role = "banker";
    let actor_user_id: string | null = userId ?? null;
    let deal_id: string | null = null;
    let bank_id: string | null = null;

    if (!userId) {
      // Allow borrower portal events ONLY with valid portal_token
      if (!portal_token) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      try {
        const invite = await requireValidInvite(portal_token);
        actor_role = "borrower";
        actor_user_id = `portal:${sha256Base64url(portal_token).slice(0, 12)}`;
        deal_id = invite.deal_id;
        bank_id = invite.bank_id;
      } catch {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
    }

    const env =
      process.env.VERCEL_ENV === "production"
        ? "production"
        : process.env.VERCEL_ENV === "preview"
          ? "preview"
          : "development";

    const release = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;

    const rows = batch
      .filter(
        (e): e is Record<string, unknown> =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as Record<string, unknown>).event_type === "string" &&
          ALLOWED_UI_TYPES.has((e as Record<string, unknown>).event_type as string),
      )
      .map((e) => ({
        source: "buddy",
        event_type: e.event_type as string,
        event_category: "ui" as const,
        severity: "info" as const,
        deal_id: (typeof e.deal_id === "string" ? e.deal_id : deal_id) ?? null,
        bank_id: (typeof e.bank_id === "string" ? e.bank_id : bank_id) ?? null,
        actor_user_id,
        actor_role,
        session_id: typeof e.session_id === "string" ? e.session_id : null,
        page_url: typeof e.page_url === "string" ? e.page_url : null,
        trace_id: typeof e.trace_id === "string" ? e.trace_id : null,
        payload: e.payload && typeof e.payload === "object" ? e.payload : {},
        expected_outcome:
          e.expected_outcome && typeof e.expected_outcome === "object"
            ? e.expected_outcome
            : null,
        actual_outcome:
          e.actual_outcome && typeof e.actual_outcome === "object" ? e.actual_outcome : null,
        is_mismatch: Boolean(e.expected_outcome && e.actual_outcome),
        env,
        release,
      }));

    if (!rows.length) return NextResponse.json({ ok: true, inserted: 0 });

    const { error } = await supabaseAdmin().from("buddy_ledger_events").insert(rows);
    if (error)
      return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (err) {
    console.error("[emit-events] exception:", err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
