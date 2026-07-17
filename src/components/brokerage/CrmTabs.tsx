"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { brokerageColors as c } from "@/components/brokerage/tokens";

const TABS = [
  { label: "Organizations", href: "/admin/brokerage/crm" },
  { label: "People", href: "/admin/brokerage/crm/people" },
  { label: "Relationships", href: "/admin/brokerage/crm/relationships" },
  { label: "Duplicates", href: "/admin/brokerage/crm/dedup" },
];

/**
 * Shared sub-nav for the three CRM object types (PR1 §3.3) plus the
 * dedup review queue. One "CRM" entry in the main nav rail
 * (BrokerageShell) fans out into these rather than adding four more
 * top-level nav items for the same underlying work.
 */
export function CrmTabs() {
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${c.border}` }}>
      {TABS.map((t) => {
        const active = t.href === "/admin/brokerage/crm" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: "8px 14px",
              fontSize: 12.5,
              fontWeight: active ? 600 : 400,
              color: active ? c.brassBright : c.textSecondary,
              borderBottom: active ? `2px solid ${c.brassBright}` : "2px solid transparent",
              marginBottom: -1,
              textDecoration: "none",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
