import "server-only";

import { Suspense } from "react";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { listBrokerageTeam } from "@/lib/brokerage/team";
import QueuesClient from "./QueuesClient";

export const dynamic = "force-dynamic";

export default async function ManagementQueuesPage() {
  const bankId = await getBrokerageBankId();
  const team = await listBrokerageTeam(bankId);
  // QueuesClient reads ?queue= via useSearchParams, which Next requires be
  // wrapped in a Suspense boundary on a server-rendered page.
  return (
    <Suspense fallback={null}>
      <QueuesClient team={team} />
    </Suspense>
  );
}
