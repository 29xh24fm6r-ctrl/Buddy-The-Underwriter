import "server-only";

import type { ReactNode } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { BankerShell } from "@/components/shell/BankerShell";

export const dynamic = "force-dynamic";

export default async function LenderLayout({ children }: { children: ReactNode }) {
  await requireRole(["bank_admin", "underwriter", "super_admin"]);
  return (
    <BankerShell>
      <nav className="border-b border-neutral-800 bg-neutral-950">
        <div className="max-w-6xl mx-auto px-8 py-3 flex gap-6 text-sm">
          <span className="font-semibold">Lender</span>
          <Link href="/lender/listings" className="underline">
            Marketplace
          </Link>
          <Link href="/lender/claims" className="underline">
            Claims
          </Link>
        </div>
      </nav>
      {children}
    </BankerShell>
  );
}
