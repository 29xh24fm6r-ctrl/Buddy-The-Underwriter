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
      className={`text-sm px-2 py-1 rounded hover:bg-muted/60 transition ${
        active ? "bg-muted font-medium" : "text-muted-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

export default function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <NavLink href="/admin" label="Admin" />
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
