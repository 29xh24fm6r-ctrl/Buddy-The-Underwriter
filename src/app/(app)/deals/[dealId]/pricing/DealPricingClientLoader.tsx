"use client";

import dynamic from "next/dynamic";

const DealPricingClient = dynamic(() => import("./DealPricingClient"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-white/10 p-8 text-center text-sm text-white/50">
      Loading pricing calculator...
    </div>
  ),
});

export default DealPricingClient;
