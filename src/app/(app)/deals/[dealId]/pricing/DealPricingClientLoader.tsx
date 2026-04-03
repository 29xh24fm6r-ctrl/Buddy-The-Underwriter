"use client";

import dynamic from "next/dynamic";

const DealPricingClient = dynamic(() => import("./DealPricingClient"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border p-8 text-center text-sm text-slate-500">
      Loading pricing calculator...
    </div>
  ),
});

export default DealPricingClient;
