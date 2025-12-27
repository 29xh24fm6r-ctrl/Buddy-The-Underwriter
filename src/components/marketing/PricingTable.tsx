"use client";

import Link from "next/link";
import { useCapture } from "@/components/analytics/useCapture";

const PRO_PRICE_ID = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;

const PLANS = [
  {
    name: "Starter",
    price: "$0",
    period: "forever",
    description: "Trial deals to test the platform",
    features: [
      "Up to 3 test deals",
      "All core features",
      "Community support"
    ]
  },
  {
    name: "Pro",
    price: "$299",
    period: "per month",
    description: "Unlimited SBA deals for growing lenders",
    features: [
      "Unlimited deals",
      "Multi-bank offers",
      "Priority support",
      "Custom bank overlays",
      "API access"
    ],
    featured: true
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For banks with high volume",
    features: [
      "Everything in Pro",
      "Dedicated success manager",
      "Custom integrations",
      "SLA guarantees",
      "White-label options"
    ]
  }
];

export function PricingTable() {
  const capture = useCapture();

  async function startCheckout() {
    capture("pricing_checkout_click", { tier: "pro" });

    if (!PRO_PRICE_ID) {
      // No Stripe configured → route to contact
      window.location.href = "/contact";
      return;
    }

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceId: PRO_PRICE_ID }),
      });

      const json = await res.json();
      if (json?.url) {
        window.location.href = json.url;
      } else {
        // Stripe error → fallback to contact
        console.error("Stripe checkout failed:", json?.error);
        window.location.href = "/contact";
      }
    } catch (e: any) {
      // Network error → fallback to contact
      console.error("Checkout error:", e);
      window.location.href = "/contact";
    }
  }

  return (
    <section className="py-20 px-6 bg-gray-50">
      <h2 className="text-4xl font-bold text-center mb-4">Simple, Transparent Pricing</h2>
      <p className="text-center text-gray-600 mb-12">
        Start free, scale when ready
      </p>
      <div className="flex flex-wrap justify-center gap-6 max-w-6xl mx-auto">
        {PLANS.map(plan => (
          <div
            key={plan.name}
            className={`border rounded-lg p-8 w-full md:w-80 ${
              plan.featured
                ? "border-black shadow-xl"
                : "border-gray-200"
            } bg-white`}
          >
            <h3 className="font-bold text-xl mb-2">{plan.name}</h3>
            <div className="mb-4">
              <span className="text-4xl font-bold">{plan.price}</span>
              {plan.period && (
                <span className="text-gray-600 ml-2">/ {plan.period}</span>
              )}
            </div>
            <p className="text-gray-600 mb-6">{plan.description}</p>
            <ul className="space-y-3 mb-8">
              {plan.features.map(feature => (
                <li key={feature} className="flex items-start">
                  <span className="mr-2">✓</span>
                  <span className="text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>
            {plan.name === "Pro" ? (
              <button
                onClick={startCheckout}
                className="block w-full text-center px-6 py-3 rounded font-semibold bg-black text-white hover:bg-gray-800"
              >
                Upgrade to Pro
              </button>
            ) : plan.name === "Enterprise" ? (
              <Link
                href="/contact"
                onClick={() => capture("pricing_contact_click", { tier: "enterprise" })}
                className="block text-center px-6 py-3 rounded font-semibold border-2 border-gray-300 hover:border-gray-400"
              >
                Contact Sales
              </Link>
            ) : (
              <Link
                href="/signup"
                onClick={() => capture("pricing_signup_click", { tier: "starter" })}
                className="block text-center px-6 py-3 rounded font-semibold border-2 border-gray-300 hover:border-gray-400"
              >
                Get Started
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
