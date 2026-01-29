import crypto from "crypto";
import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase";

function timingSafeEqualHex(a: string, b: string) {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function hmac(rawBody: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

// ─── Observer event validation (product === "buddy") ─────────────────────────

function isValidObserverPayload(body: any) {
  if (!body || typeof body !== "object") return false;
  if (body.product !== "buddy") return false;
  if (!body.env || !body.type || !body.severity || !body.message || !body.fingerprint) return false;
  if (typeof body.message !== "string") return false;
  if (typeof body.fingerprint !== "string") return false;
  return true;
}

// ─── Ledger event validation (source === "buddy") ───────────────────────────

function isValidLedgerPayload(body: any) {
  if (!body || typeof body !== "object") return false;
  if (body.source !== "buddy") return false;
  if (!body.env || typeof body.env !== "string") return false;
  if (!body.deal_id || typeof body.deal_id !== "string") return false;
  if (!body.event_key || typeof body.event_key !== "string") return false;
  if (!body.created_at || typeof body.created_at !== "string") return false;
  if (!body.trace_id || typeof body.trace_id !== "string") return false;
  return true;
}

// ─── Shared HMAC verification ───────────────────────────────────────────────

function verifySignature(req: Request, res: Response, secret: string): string | null {
  const sig = String(req.header("x-pulse-signature") ?? "");
  const rawBody = (req as any).rawBody as string | undefined;

  if (!rawBody) {
    res.status(400).json({ error: "rawBody missing" });
    return null;
  }

  const expected = hmac(rawBody, secret);
  if (!sig || !timingSafeEqualHex(sig, expected)) {
    res.status(401).json({ error: "invalid signature" });
    return null;
  }

  return rawBody;
}

// ─── Observer event handler ─────────────────────────────────────────────────

async function handleObserverEvent(body: any, res: Response) {
  // 1) Insert event (append-only)
  const ins = await supabaseAdmin
    .from("buddy_observer_events")
    .insert(body)
    .select("created_at, deal_id, env, stage, severity, fingerprint, message, trace_id, request_id, release, type")
    .maybeSingle();

  if (ins.error) return res.status(500).json({ error: ins.error.message });

  // 2) Upsert deal state (if deal_id present) - fail-soft
  const ev = ins.data;
  if (ev?.deal_id) {
    try {
      const isError = ev.severity === "error" || ev.severity === "fatal";
      const isTransition = ev.type === "deal.transition";

      const patch: any = {
        deal_id: ev.deal_id,
        env: ev.env,
        last_event_at: ev.created_at,
        last_trace_id: ev.trace_id ?? null,
        last_request_id: ev.request_id ?? null,
        last_release: ev.release ?? null,
        updated_at: new Date().toISOString(),
      };

      if (ev.stage) patch.current_stage = ev.stage;
      if (isTransition) patch.last_transition_at = ev.created_at;
      if (isError) {
        patch.last_error_at = ev.created_at;
        patch.last_error_fingerprint = ev.fingerprint;
        patch.last_error_message = ev.message;
      }

      await supabaseAdmin.from("buddy_deal_state").upsert(patch, { onConflict: "deal_id" });
    } catch {
      // swallow — deal state is best-effort
    }
  }

  return res.status(202).json({ ok: true });
}

// ─── Ledger event handler ───────────────────────────────────────────────────

async function handleLedgerEvent(body: any, res: Response) {
  // Idempotent upsert keyed on trace_id (ledger row ID)
  const row = {
    source: "buddy",
    env: body.env,
    deal_id: body.deal_id,
    bank_id: body.bank_id ?? null,
    event_key: body.event_key,
    event_created_at: body.created_at,
    trace_id: body.trace_id,
    payload: body.payload ?? {},
  };

  const ins = await supabaseAdmin
    .from("buddy_ledger_events")
    .upsert(row, { onConflict: "trace_id", ignoreDuplicates: true })
    .select("trace_id")
    .maybeSingle();

  if (ins.error) return res.status(500).json({ error: ins.error.message });

  return res.status(202).json({ ok: true });
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function ingestBuddy(req: Request, res: Response) {
  const secret = process.env.PULSE_BUDDY_INGEST_SECRET;
  if (!secret) return res.status(500).json({ error: "missing PULSE_BUDDY_INGEST_SECRET" });

  const verified = verifySignature(req, res, secret);
  if (verified === null) return; // response already sent

  const body = req.body ?? {};

  // Route based on envelope type
  if (isValidLedgerPayload(body)) {
    return handleLedgerEvent(body, res);
  }

  if (isValidObserverPayload(body)) {
    return handleObserverEvent(body, res);
  }

  return res.status(400).json({ error: "invalid payload" });
}
