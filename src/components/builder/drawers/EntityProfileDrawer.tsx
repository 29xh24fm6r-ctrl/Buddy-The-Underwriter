"use client";

import { DrawerShell } from "./DrawerShell";
import type { BorrowerCard } from "@/lib/builder/builderTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  owner: BorrowerCard | null;
};

export function EntityProfileDrawer({ open, onClose, owner }: Props) {
  if (!owner) return null;

  return (
    <DrawerShell open={open} onClose={onClose} title="Entity Profile">
      <div className="space-y-4">
        <div className="text-sm font-semibold text-white">Core Info</div>
        <div className="space-y-2 text-sm">
          <Row label="Name" value={owner.full_legal_name} />
          <Row label="Title" value={owner.title} />
          <Row label="Ownership" value={owner.ownership_pct != null ? `${owner.ownership_pct}%` : undefined} />
          <Row label="DOB" value={owner.dob} />
          <Row label="SSN Last 4" value={owner.ssn_last4 ? `***-**-${owner.ssn_last4}` : undefined} />
          <Row label="Address" value={[owner.home_address, owner.home_city, owner.home_state, owner.home_zip].filter(Boolean).join(", ") || undefined} />
          <Row label="Years w/ Company" value={owner.years_with_company != null ? String(owner.years_with_company) : undefined} />
          <Row label="Credit Auth" value={owner.credit_auth_obtained ? "Yes" : "No"} />
        </div>
      </div>
    </DrawerShell>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 pb-1">
      <span className="text-white/50">{label}</span>
      <span className="text-white">{value || "\u2014"}</span>
    </div>
  );
}
