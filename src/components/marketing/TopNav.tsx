"use client";

export function TopNav() {
  return (
    <div className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl border shadow-sm" />
          <div className="text-sm font-semibold tracking-tight">Buddy</div>
          <div className="text-xs text-muted-foreground">Underwriting OS</div>
        </div>
        <div className="flex items-center gap-2">
          <a className="rounded-xl border px-3 py-2 text-sm hover:bg-muted" href="#product">
            Product
          </a>
          <a className="rounded-xl border px-3 py-2 text-sm hover:bg-muted" href="#replay">
            Replay
          </a>
          <a className="rounded-xl border px-3 py-2 text-sm hover:bg-muted" href="#governance">
            Governance
          </a>
          <a className="rounded-xl border px-3 py-2 text-sm font-medium hover:bg-muted" href="/deals">
            Open App
          </a>
        </div>
      </div>
    </div>
  );
}
