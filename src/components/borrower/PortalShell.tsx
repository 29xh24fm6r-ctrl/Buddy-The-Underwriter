"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

export function PortalShell({
  title,
  subtitle,
  left,
  center,
  right,
}: {
  title: string;
  subtitle?: string;
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)_360px]">
      {/* Left */}
      <section className="rounded-2xl bg-white text-neutral-900 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
        <header className="border-b border-neutral-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name="auto_awesome" className="h-5 w-5 text-neutral-900" />
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
          {subtitle ? (
            <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>
          ) : null}
        </header>
        <div className="p-4">{left}</div>
      </section>

      {/* Center */}
      <section className="rounded-2xl bg-white text-neutral-900 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
        <div className="p-4 lg:p-6">{center}</div>
      </section>

      {/* Right */}
      <aside className="rounded-2xl bg-white text-neutral-900 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
        <div className="p-4 lg:p-6">{right}</div>
      </aside>
    </div>
  );
}
