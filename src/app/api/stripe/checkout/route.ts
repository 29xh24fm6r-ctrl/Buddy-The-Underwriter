import Stripe from "stripe";
import { NextResponse } from "next/server";
import { resolveUserApiContext } from "@/lib/server/userApiContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function configuredPriceId() {
  return (
    process.env.STRIPE_PRO_PRICE_ID?.trim() ||
    process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID?.trim() ||
    ""
  );
}

function trustedCheckoutOrigin() {
  const configured = process.env.PUBLIC_BASE_URL?.trim() || "https://www.buddysba.com";
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let actor: Awaited<ReturnType<typeof resolveUserApiContext>>;
  try {
    actor = await resolveUserApiContext();
  } catch {
    return json(503, { ok: false, error: "authentication_unavailable" });
  }

  if (!actor.ok) {
    return json(actor.status, { ok: false, error: actor.error });
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "payload_too_large" });
  }

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return json(400, { ok: false, error: "invalid_request" });
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "payload_too_large" });
  }

  let body: Record<string, unknown> = {};
  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(400, { ok: false, error: "invalid_json" });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json(400, { ok: false, error: "invalid_json" });
    }
  }

  const priceId = configuredPriceId();
  if (!priceId) {
    return json(503, { ok: false, error: "checkout_not_configured" });
  }

  const requestedPriceId =
    typeof body.priceId === "string" ? body.priceId.trim() : "";
  if (requestedPriceId && requestedPriceId !== priceId) {
    return json(400, { ok: false, error: "invalid_price" });
  }

  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const origin = trustedCheckoutOrigin();
  if (!secret || !origin) {
    return json(503, { ok: false, error: "checkout_not_configured" });
  }

  const stripe = new Stripe(secret, {
    apiVersion: "2025-12-15.clover" as any,
  });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: actor.actorProfileId,
      metadata: {
        actor_profile_id: actor.actorProfileId,
        plan: "pro",
      },
      subscription_data: {
        metadata: {
          actor_profile_id: actor.actorProfileId,
          plan: "pro",
        },
      },
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: origin + "/pricing?checkout=success",
      cancel_url: origin + "/pricing?checkout=cancel",
    });

    if (!session.url) {
      return json(503, { ok: false, error: "checkout_unavailable" });
    }

    let checkoutUrl: URL;
    try {
      checkoutUrl = new URL(session.url);
    } catch {
      return json(503, { ok: false, error: "checkout_unavailable" });
    }
    if (checkoutUrl.protocol !== "https:") {
      return json(503, { ok: false, error: "checkout_unavailable" });
    }

    return json(200, { ok: true, url: checkoutUrl.toString() });
  } catch (error) {
    console.error("[stripe/checkout] session creation failed", {
      type: error instanceof Error ? error.name : "unknown",
    });
    return json(503, { ok: false, error: "checkout_unavailable" });
  }
}
