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

function isValidPayload(body: any) {
  if (!body || typeof body !== "object") return false;
  if (body.product !== "buddy") return false;
  if (!body.env || !body.type || !body.severity || !body.message || !body.fingerprint) return false;
  if (typeof body.message !== "string") return false;
  if (typeof body.fingerprint !== "string") return false;
  // schema_version optional on wire but Buddy sends it; accept if missing and default in DB
  return true;
}

export async function ingestBuddy(req: Request, res: Response) {
  const secret = process.env.PULSE_BUDDY_INGEST_SECRET;
  if (!secret) return res.status(500).json({ error: "missing PULSE_BUDDY_INGEST_SECRET" });

  const sig = String(req.header("x-pulse-signature") ?? "");
  const rawBody = (req as any).rawBody as string | undefined;

  if (!rawBody) return res.status(400).json({ error: "rawBody missing" });

  const expected = hmac(rawBody, secret);
  if (!sig || !timingSafeEqualHex(sig, expected)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const body = req.body ?? {};
  if (!isValidPayload(body)) {
    return res.status(400).json({ error: "invalid payload" });
  }

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
