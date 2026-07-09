import "server-only";

import type { ReactNode } from "react";
import { BankerShell } from "@/components/shell/BankerShell";

export const dynamic = "force-dynamic";

/**
 * /admin/* (plain tree) — theme wrapper only, no gate at this level.
 *
 * This tree contains exactly two subtrees: /admin/brokerage/* and
 * /admin/metrics. They need different bars (brokerage staff vs.
 * super_admin), so each carries its own layout with its own gate instead
 * of a single blanket super_admin check here. Previously this file gated
 * everything under it to super_admin, which meant a brokerage partner
 * added as bank_admin on the Buddy Brokerage tenant — the normal way to
 * add someone to the business — got redirected away from every brokerage
 * page despite being exactly who those pages are for.
 */
export default function AdminRootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <BankerShell>{children}</BankerShell>;
}
