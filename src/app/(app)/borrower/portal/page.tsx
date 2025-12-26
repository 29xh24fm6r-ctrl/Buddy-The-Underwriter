import { Suspense } from "react";
import BorrowerPortalClient from "./BorrowerPortalClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BorrowerPortalClient />
    </Suspense>
  );
}
