"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function NavItem({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: string;
}) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== "/deals" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={[
        "flex flex-col items-center gap-1 group w-full px-1 relative",
        active ? "opacity-100" : "opacity-80 hover:opacity-100",
      ].join(" ")}
    >
      {active ? (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-[0_0_14px_rgba(19,109,236,0.25)]" />
      ) : null}

      <div
        className={[
          "p-2 rounded-lg transition-all",
          active
            ? "text-primary bg-primary/10"
            : "text-slate-400 group-hover:text-white group-hover:bg-[#1f242d]",
        ].join(" ")}
      >
        <span className="material-symbols-outlined text-[24px]">{icon}</span>
      </div>
      <span
        className={[
          "text-[10px] font-medium",
          active ? "text-primary" : "text-slate-500 group-hover:text-slate-300",
        ].join(" ")}
      >
        {label}
      </span>
    </Link>
  );
}

export default function DealsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const dealMatch = pathname.match(/^\/deals\/([0-9a-f-]{36})/i);
  const dealId = dealMatch ? dealMatch[1] : null;
  const underwriteHref = dealId ? `/deals/${dealId}/underwrite` : "/underwrite";

  return (
    <div className="min-h-screen bg-[#0b0d10] text-white flex">
      {/* Persistent left rail */}
      <nav className="w-[72px] shrink-0 bg-[#111418] border-r border-white/10 flex flex-col items-center py-6 gap-6 z-20">
        <NavItem href="/command" label="Command" icon="dashboard" />
        <NavItem href="/deals" label="Deals" icon="content_paste" />
        <NavItem href="/deals/new" label="Intake" icon="input" />
        <NavItem href={underwriteHref} label="Undrwrt" icon="analytics" />
        <NavItem href="/documents" label="Evidence" icon="folder_open" />
        <div className="flex-1" />
        <NavItem href="/settings" label="Settings" icon="settings" />
      </nav>

      {/* Main content */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
