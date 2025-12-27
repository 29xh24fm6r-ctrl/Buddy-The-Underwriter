"use client";

import Link from "next/link";
import { useCapture } from "@/components/analytics/useCapture";

export function Hero() {
  const capture = useCapture();
  const demoUrl = process.env.NEXT_PUBLIC_DEMO_CALENDAR_URL;

  return (
    <section className="py-24 px-6 text-center bg-gradient-to-b from-gray-50 to-white">
      <h1 className="text-5xl font-bold mb-6 text-gray-900">
        SBA Lending, Finally Done Right
      </h1>
      <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
        Buddy turns SBA underwriting from a nightmare into a guided,
        automated, examiner-safe experience.
      </p>
      <div className="flex justify-center gap-4 flex-wrap">
        <Link
          href="/signup"
          onClick={() => capture("cta_click", { location: "hero", cta: "signup" })}
          className="px-8 py-3 bg-black text-white rounded-lg font-semibold hover:bg-gray-800"
        >
          Start Free Trial
        </Link>
        <Link
          href="/pricing"
          onClick={() => capture("cta_click", { location: "hero", cta: "pricing" })}
          className="px-8 py-3 border-2 border-gray-300 rounded-lg font-semibold hover:border-gray-400"
        >
          See Pricing
        </Link>
        <Link
          href="/demo"
          onClick={() => capture("cta_click", { location: "hero", cta: "demo" })}
          className="px-8 py-3 border-2 border-gray-300 rounded-lg font-semibold hover:border-gray-400"
        >
          Watch Demo
        </Link>
        {demoUrl && (
          <a
            href={demoUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => capture("demo_request_click", { location: "hero" })}
            className="px-8 py-3 border-2 border-gray-300 rounded-lg font-semibold hover:border-gray-400"
          >
            Request Demo
          </a>
        )}
      </div>
    </section>
  );
}
