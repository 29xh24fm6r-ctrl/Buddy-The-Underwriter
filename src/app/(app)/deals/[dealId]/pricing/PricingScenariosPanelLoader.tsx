"use client";

import dynamic from "next/dynamic";

const PricingScenariosPanel = dynamic(() => import("./PricingScenariosPanel"), {
  ssr: false,
  loading: () => (
    <div className="mt-8 text-center text-sm text-white/40 py-4">
      Loading pricing scenarios...
    </div>
  ),
});

export default PricingScenariosPanel;
