"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import AdminBankPicker from "@/components/admin/AdminBankPicker";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`text-sm px-2 py-1 rounded hover:bg-neutral-800 transition ${
        active ? "bg-neutral-800 font-medium text-neutral-50" : "text-neutral-300"
      }`}
    >
      {label}
    </Link>
  );
}

export default function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950">
      {/*
        Explicit neutral-* colors rather than bg-background/text-muted-foreground:
        those CSS variables depend on a `dark` class this route tree doesn't
        reliably apply, which rendered this whole bar white-text-on-white —
        the new "Command Center" link was technically present and clickable
        but invisible. Found during live QA of SPEC-BROKERAGE-OPERATING-SYSTEM-V1.
      */}
      <div className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
        <div className="px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <NavLink href="/admin" label="Admin" />
            <NavLink href="/admin/brokerage" label="Brokerage HQ" />
            <NavLink href="/admin/brokerage/command-center" label="Command Center" />
            <NavLink href="/admin/brokerage/lenders" label="Lenders" />
            <NavLink href="/admin/brokerage-owner" label="Owner Command Center" />
            <NavLink href="/admin/audit" label="Audit" />
            <NavLink href="/admin/templates" label="Templates" />
            <NavLink href="/admin/fields" label="Fields" />
            <NavLink href="/admin/merge-fields" label="Merge Fields" />
            <NavLink href="/admin/email-routing" label="Email" />
            <NavLink href="/admin/roles" label="Roles" />
          </div>
          <AdminBankPicker />
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
