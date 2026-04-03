"use client";

import dynamic from "next/dynamic";

const IntelligenceClient = dynamic(() => import("./IntelligenceClient"), {
  ssr: false,
  loading: () => (
    <div className="px-6 py-12 text-center text-sm text-white/40">
      Loading intelligence...
    </div>
  ),
});

export default IntelligenceClient;
