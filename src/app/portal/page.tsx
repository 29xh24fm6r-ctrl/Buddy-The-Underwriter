// src/app/portal/page.tsx
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PortalOverviewPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold">Borrower Portal</h1>
      <p className="text-muted-foreground mt-2">
        View the borrower-facing portal experience.
      </p>

      <div className="mt-6 grid gap-4">
        <Link
          href="/borrower/portal"
          className="rounded-2xl border p-6 hover:bg-muted/40 transition-colors"
        >
          <div className="text-lg font-semibold">Borrower Portal</div>
          <div className="text-sm text-muted-foreground mt-1">
            View the main borrower portal interface
          </div>
        </Link>

        <div className="rounded-2xl border p-6">
          <div className="text-lg font-semibold">Portal Management</div>
          <div className="text-sm text-muted-foreground mt-2">
            Coming soon: Manage portal settings, invites, and templates
          </div>
        </div>
      </div>
    </div>
  );
}
