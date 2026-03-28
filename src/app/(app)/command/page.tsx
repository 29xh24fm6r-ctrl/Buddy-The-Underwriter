import { Suspense } from "react";
import BankerCommandCenterPage from "@/components/command-center/BankerCommandCenterPage";

export const dynamic = "force-dynamic";

export default function CommandPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-white/40 text-sm">Loading Command Center...</p>
        </div>
      }
    >
      <BankerCommandCenterPage />
    </Suspense>
  );
}
