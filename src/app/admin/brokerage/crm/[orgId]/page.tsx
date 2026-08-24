"use client";

import { use as usePromise } from "react";
import { BankBuyersWorkspace } from "@/components/brokerage/BankBuyersWorkspace";
import { OrganizationWorkspace } from "@/components/brokerage/OrganizationWorkspace";

export default function CrmOrganizationRoute({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = usePromise(params);
  return orgId === "buyers"
    ? <BankBuyersWorkspace />
    : <OrganizationWorkspace orgId={orgId} />;
}
