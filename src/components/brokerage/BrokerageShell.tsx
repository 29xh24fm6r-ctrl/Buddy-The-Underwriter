"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { brokerageColors as c } from "./tokens";

/**
 * Nav rail + top bar shell for the brokerage system. Ported from the
 * Claude Design prototype's <aside>/<header> structure — same layout,
 * same tokens, real routes instead of the prototype's in-memory router.
 */

type NavItem = {
  label: string;
  href: string;
  icon: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Do the work",
    items: [
      { label: "Command center", href: "/admin/brokerage", icon: "◈" },
      { label: "Deals", href: "/deals", icon: "▦" },
      { label: "Lenders", href: "/admin/brokerage/lenders", icon: "▤" },
      { label: "CRM", href: "/admin/brokerage/crm", icon: "◇" },
    ],
  },
  {
    label: "Run the business",
    items: [
      { label: "Billing", href: "/admin/brokerage/billing", icon: "▧" },
      { label: "Owner command", href: "/admin/brokerage-owner", icon: "◉" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Team & roles", href: "/admin/brokerage/team", icon: "◐" },
      { label: "Ops health", href: "/admin/brokerage/listings", icon: "◍" },
      { label: "Launch readiness", href: "/admin/brokerage/launch-readiness", icon: "⚑" },
    ],
  },
];

const TITLES: Record<string, [string, string]> = {
  "/admin/brokerage": ["Command center", "Your daily front door"],
  "/deals": ["Deals pipeline", "The working pipeline"],
  "/admin/brokerage/lenders": ["Lenders", "Partner banks · matching criteria & terms"],
  "/admin/brokerage/crm": ["CRM", "Referral organizations"],
  "/admin/brokerage/billing": ["Billing", "Lender referral-fee invoices"],
  "/admin/brokerage-owner": ["Owner command center", "Business-level view"],
  "/admin/brokerage/team": ["Team & roles", "Access and workload"],
  "/admin/brokerage/listings": ["Ops health", "Listings & sessions"],
  "/admin/brokerage/uploads": ["Ops health", "Uploads pending OCR"],
  "/admin/brokerage/packages": ["Ops health", "Sealed packages"],
  "/admin/brokerage/comms": ["Ops health", "Communications"],
  "/admin/brokerage/launch-readiness": ["Launch readiness", "Production punch-list"],
  "/admin/brokerage/deals": ["Stuck deals", "By origin, oldest first"],
};

function titleFor(pathname: string): [string, string] {
  if (TITLES[pathname]) return TITLES[pathname];
  // Dynamic routes (e.g. /admin/brokerage/crm/[orgId])
  for (const [prefix, title] of Object.entries(TITLES)) {
    if (prefix !== "/" && pathname.startsWith(prefix + "/")) return title;
  }
  return ["Buddy Brokerage", ""];
}

export function BrokerageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const [title, subtitle] = titleFor(pathname);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        background: c.ink,
        color: c.paper,
        fontFamily: "var(--font-brokerage-sans)",
        fontSize: 13,
        overflow: "hidden",
      }}
    >
      {/* Nav rail */}
      <aside
        style={{
          width: 236,
          flex: "none",
          background: c.inkRail,
          borderRight: `1px solid ${c.border}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 18px 16px",
            borderBottom: `1px solid ${c.border}`,
            display: "flex",
            alignItems: "center",
            gap: 11,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              flex: "none",
              borderRadius: 6,
              background: `linear-gradient(150deg, ${c.brassBright}, ${c.brass})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 0 1px 3px rgba(0,0,0,.4)",
            }}
          >
            <span style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 700, fontSize: 19, color: c.brassOnBrass }}>
              B
            </span>
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 700, fontSize: 16, letterSpacing: 0.2 }}>
              Buddy
            </div>
            <div
              style={{
                fontFamily: "var(--font-brokerage-mono)",
                fontSize: 9,
                letterSpacing: 2.5,
                color: c.textMuted,
                textTransform: "uppercase",
                marginTop: 1,
              }}
            >
              Brokerage
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, overflowY: "auto", padding: "14px 10px" }}>
          {NAV_GROUPS.map((grp) => (
            <div key={grp.label} style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontFamily: "var(--font-brokerage-mono)",
                  fontSize: 9,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: c.textFaint,
                  padding: "0 10px 7px",
                }}
              >
                {grp.label}
              </div>
              {grp.items.map((it) => {
                const active = pathname === it.href || pathname.startsWith(it.href + "/");
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "7px 10px",
                      borderRadius: 5,
                      cursor: "pointer",
                      marginBottom: 1,
                      color: active ? c.brassBright : c.paper,
                      background: active ? "rgba(184,144,91,.12)" : "transparent",
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ width: 15, textAlign: "center", fontSize: 13, opacity: 0.9 }}>{it.icon}</span>
                    <span style={{ flex: 1, fontWeight: active ? 600 : 400, fontSize: 12.5 }}>{it.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ padding: "12px 14px", borderTop: `1px solid ${c.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              flex: "none",
              borderRadius: "50%",
              background: c.borderStrong,
              border: `1px solid ${c.borderStronger}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-brokerage-display)",
              fontWeight: 600,
              fontSize: 13,
              color: c.brassBright,
            }}
          >
            MP
          </div>
          <div style={{ flex: 1, lineHeight: 1.2, overflow: "hidden" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: c.paper, whiteSpace: "nowrap" }}>Buddy Brokerage</div>
            <div style={{ fontSize: 10, color: c.textMuted }}>Founder · Owner</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <header
          style={{
            flex: "none",
            height: 60,
            borderBottom: `1px solid ${c.border}`,
            background: c.ink,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 22px",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 19, color: c.paper, lineHeight: 1.1 }}>
              {title}
            </div>
            {subtitle && <div style={{ fontSize: 11, color: c.textMuted, marginTop: 1 }}>{subtitle}</div>}
          </div>
        </header>

        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>{children}</div>
      </main>
    </div>
  );
}
