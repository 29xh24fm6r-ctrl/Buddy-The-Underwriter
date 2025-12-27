import { Suspense } from "react";
import EmailRoutingClient from "./EmailRoutingClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-white/70">Loading…</div>}>
      <EmailRoutingClient />
    </Suspense>
  );
}
