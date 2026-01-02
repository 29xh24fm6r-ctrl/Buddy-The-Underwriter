export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AuthClient from "./AuthClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AuthClient />
    </Suspense>
  );
}
