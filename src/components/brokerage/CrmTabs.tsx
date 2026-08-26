"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { crmColors as c } from "@/components/brokerage/tokens";

const TABS = [
  { label: "Leads", href: "/admin/brokerage/crm/leads", description: "New borrower and referral opportunities" },
  { label: "Organizations", href: "/admin/brokerage/crm", description: "Banks, businesses, and professional partners" },
  { label: "Bank buyers", href: "/admin/brokerage/crm/buyers", description: "Bankers, marketplace access, appetite, and deal distribution" },
  { label: "Contacts", href: "/admin/brokerage/crm/people", description: "Individual people and their organizations" },
  { label: "Deal partners", href: "/admin/brokerage/crm/relationships", description: "External parties attached to a deal" },
  { label: "Duplicates", href: "/admin/brokerage/crm/dedup", description: "Review possible duplicate records" },
  { label: "Templates", href: "/admin/brokerage/crm/templates", description: "Reusable communication templates" },
];

/**
 * Shared sub-nav for the CRM object types (PR1 §3.3) plus the lead
 * pipeline (PR2 §4.4) and the dedup review queue. One "CRM" entry in the
 * main nav rail (BrokerageShell) fans out into these rather than adding
 * more top-level nav items for the same underlying work.
 */
export function CrmTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="CRM sections" style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${c.border}`, overflowX: "auto" }}>
      {TABS.map((t) => {
        const active = t.href === "/admin/brokerage/crm" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            title={t.description}
            aria-current={active ? "page" : undefined}
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
    </nav>
  );
}
