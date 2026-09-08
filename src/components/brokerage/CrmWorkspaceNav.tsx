"use client";

import React from "react";
import Link from "next/link";
import { CRM_ROOT } from "@/lib/crm/experience";
import type { CrmSection } from "@/lib/crm/experience";

const sections: { key: CrmSection; label: string; href: string; description: string }[] = [
  { key: "today", label: "Today", href: CRM_ROOT, description: "A clear next step for every relationship." },
  { key: "pipeline", label: "Pipeline", href: `${CRM_ROOT}/leads`, description: "Move borrower and referral opportunities forward." },
  { key: "relationships", label: "Relationships", href: `${CRM_ROOT}?view=relationships`, description: "Your companies, people, and deal connections in one place." },
  { key: "lenders", label: "Lender network", href: `${CRM_ROOT}/buyers`, description: "Find the right bank, build the relationship, and track every placement." },
  { key: "tools", label: "Tools", href: `${CRM_ROOT}/templates`, description: "Keep communications consistent and your records clean." },
];

export function CrmWorkspaceNav({ section, pathname }: { section: CrmSection; pathname: string }) {
  const current = sections.find((item) => item.key === section)!;
  const secondary = section === "relationships" ? [
    { label: "Companies", href: `${CRM_ROOT}?view=relationships`, active: pathname === CRM_ROOT || !["/people", "/relationships"].some((part) => pathname.startsWith(`${CRM_ROOT}${part}`)) },
    { label: "People", href: `${CRM_ROOT}/people`, active: pathname.startsWith(`${CRM_ROOT}/people`) },
    { label: "Deal connections", href: `${CRM_ROOT}/relationships`, active: pathname.startsWith(`${CRM_ROOT}/relationships`) },
  ] : section === "tools" ? [
    { label: "Message templates", href: `${CRM_ROOT}/templates`, active: pathname.startsWith(`${CRM_ROOT}/templates`) },
    { label: "Duplicate review", href: `${CRM_ROOT}/dedup`, active: pathname.startsWith(`${CRM_ROOT}/dedup`) },
  ] : [];
  return (
    <header className="crm-experience crm-workspace-header">
      <nav aria-label="CRM sections" className="crm-primary-nav">
        {sections.map((item) => <Link key={item.key} href={item.href} prefetch={false} aria-current={item.key === section ? "page" : undefined}>{item.label}</Link>)}
      </nav>
      <div className="crm-page-heading"><div><p className="crm-eyebrow">Buddy CRM</p><h1>{current.label}</h1><p>{current.description}</p></div><Link className="crm-button crm-button-secondary" href={`${CRM_ROOT}?view=relationships`} prefetch={false}>Find a relationship</Link></div>
      {secondary.length > 0 ? <nav aria-label={`${current.label} views`} className="crm-secondary-nav">{secondary.map((item) => <Link key={item.href} href={item.href} prefetch={false} aria-current={item.active ? "page" : undefined}>{item.label}</Link>)}</nav> : null}
    </header>
  );
}
