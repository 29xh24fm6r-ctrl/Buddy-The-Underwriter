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
          </Link>
          <a className="rounded-xl border px-3 py-2 text-sm hover:bg-muted" href="#replay">
            Replay
          </Link>
          <a className="rounded-xl border px-3 py-2 text-sm hover:bg-muted" href="#governance">
            Governance
          </Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"  href="/sign-in">
            Sign In
          </Link>
          <Link className="rounded-xl border bg-black text-white px-3 py-2 text-sm font-medium hover:bg-gray-800"  href="/sign-up">
            Sign Up
          </Link>
        </div>
      </div>
    </div>
  );
}
