"use client";

import { use as usePromise } from "react";
import { OrganizationWorkspace } from "@/components/brokerage/OrganizationWorkspace";

export default function CrmOrganizationRoute({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = usePromise(params);
  return <OrganizationWorkspace orgId={orgId} />;
}
