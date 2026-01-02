"use client";

import * as React from "react";
import { OwnershipConfirmPanel } from "@/components/portal/OwnershipConfirmPanel";

export function OwnershipSlot(props: { dealId: string }) {
  // Optional: auto-refresh evidence once when page mounts (safe)
  React.useEffect(() => {
    fetch(`/api/portal/deals/${props.dealId}/ownership/refresh`, { method: "POST" }).catch(() => {});
     
  }, [props.dealId]);

  return <OwnershipConfirmPanel dealId={props.dealId} />;
}
