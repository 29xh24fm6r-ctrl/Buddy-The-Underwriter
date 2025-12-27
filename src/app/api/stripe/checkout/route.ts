import Stripe from "stripe";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const priceId = body?.priceId as string | undefined;

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Missing STRIPE_SECRET_KEY" },
      { status: 500 }
    );
  }
  if (!priceId) {
    return NextResponse.json(
      { ok: false, error: "Missing priceId" },
      { status: 400 }
    );
  }

  const stripe = new Stripe(secret, { apiVersion: "2025-12-15.clover" as any });

  const origin = req.headers.get("origin") || "https://www.buddytheunderwriter.com";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/pricing?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancel`,
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
