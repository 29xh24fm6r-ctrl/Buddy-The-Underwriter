"use client";

import { Container } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-black/10 bg-white/80 backdrop-blur">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-2xl bg-black text-white text-sm font-semibold">
            B
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Buddy</div>
            <div className="text-xs text-black/60">Loan Operations System</div>
          </div>
          <div className="hidden sm:block">
            <Badge className="ml-3">New category: LOS++</Badge>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm text-black/70">
          <a href="#what" className="hover:text-black">What it is</a>
          <a href="#how" className="hover:text-black">How it works</a>
          <a href="#who" className="hover:text-black">Who it&apos;s for</a>
          <a href="#moat" className="hover:text-black">Why it wins</a>
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => location.assign("/deals")}>
            Load a demo deal
          </Button>
          <Button size="sm" onClick={() => location.assign("/auth")}>
            Sign in
          </Button>
        </div>
      </Container>
    </header>
  );
}
