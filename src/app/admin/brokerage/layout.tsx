import "server-only";

import type { ReactNode } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminBrokerageLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <nav className="border-b border-neutral-800 bg-neutral-950">
        <div className="max-w-6xl mx-auto px-8 py-3 flex gap-6 text-sm">
          <span className="font-semibold">Brokerage admin</span>
          <Link href="/admin/brokerage/listings" className="underline">
            Listings
          </Link>
          <Link href="/admin/brokerage/lenders" className="underline">
            Lenders
          </Link>
          <Link href="/cockpit" className="underline ml-auto">
            Cockpit
          </Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
